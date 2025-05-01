/**
 * app.js - Application Core
 *
 * - Centralized dependency management via DependencySystem.
 * - Deterministic initialization sequence using async/await.
 * - Consolidated core utilities (apiRequest, notification, UUID validation).
 * - Reduced global scope pollution (strict DependencySystem usage).
 * - Consistent use of ES Modules.
 */

/* ---------------------------------------------------------------------
 * Core Utilities (Moved up before module registrations)
 * ------------------------------------------------------------------- */
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

function stableStringify(value) {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
    return `{${Object.keys(value)
        .sort()
        .map(k => `${JSON.stringify(k)}:${stableStringify(value[k])}`)
        .join(',')}}`;
}

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

// For certain endpoints that get repeatedly fetched, skip dedup logic:
function shouldSkipDedup(url) {
    try {
        const lower = url.toLowerCase();
        if (
            lower.includes('/api/projects/') &&
            (
               lower.endsWith('/stats') ||
               lower.endsWith('/files') ||
               lower.endsWith('/artifacts') ||
               lower.endsWith('/conversations') ||
               lower.includes('/conversations?')
            )
        ) {
            return true;
        }
    } catch (e) {
        console.warn('[App] shouldSkipDedup error:', e);
    }
    return false;
}

async function apiRequest(url, opts = {}, skipCache = false) {
    // If skipCache not forced, and this is a GET, check if we should skip dedup
    if (!skipCache && (opts.method || 'GET').toUpperCase() === 'GET') {
        if (shouldSkipDedup(url)) {
            skipCache = true;
        }
    }
    const auth = DependencySystem.modules.get('auth');
    const method = (opts.method || 'GET').toUpperCase();
    const unsafeVerb = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);
    const normalizedUrl = normaliseUrl(url);

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
                    try {
                        errPayload.rawResponse = await resp.text();
                    } catch {
                        // do nothing
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

function showNotification(message, type = 'info', duration = 5000) {
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

function toggleElement(selectorOrElement, show) {
    try {
        const el = typeof selectorOrElement === 'string'
            ? document.querySelector(APP_CONFIG.SELECTORS[selectorOrElement] || selectorOrElement)
            : selectorOrElement;

        if (el instanceof HTMLElement) {
            el.classList.toggle('hidden', !show);
        } else if (APP_CONFIG.DEBUG && typeof selectorOrElement === 'string') {
            console.warn(
                `[App] toggleElement: Element not found for selector: ${APP_CONFIG.SELECTORS[selectorOrElement] || selectorOrElement}`
            );
        } else if (APP_CONFIG.DEBUG) {
            console.warn("[App] toggleElement: Invalid element passed:", selectorOrElement);
        }
    } catch (e) {
        console.error(`[App] Error in toggleElement for ${selectorOrElement}:`, e);
    }
}

  // --- Imports ---
import { createModalManager, createProjectModal } from './modalManager.js';
import { MODAL_MAPPINGS } from './modalConstants.js';
import { createProjectManager, isValidProjectId as validateUUID } from './projectManager.js';
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
import * as globalUtils from './utils/globalUtils.js';

import { createNotificationHandler } from './notification-handler.js';
import { createEventHandlers } from './eventHandler.js';
import { createAuthModule } from './auth.js';
import { waitForDepsAndDom } from './utils/initHelpers.js';

// --- Confirm DependencySystem is present before using it ---
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

// ------------------------------------------------------------------
// Guard against accidental overwriting of the chatManager instance
// ------------------------------------------------------------------
(function patchDependencySystem(ds){
    const originalRegister = ds.register.bind(ds);

    ds.register = function(key, value){
        if (key === 'chatManager' && ds.modules.has('chatManager')){
            const current = ds.modules.get('chatManager');
            // If the current value is a *valid* instance keep it.
            if (current && typeof current.loadConversation === 'function'){
                if (APP_CONFIG.DEBUG){
                    console.warn('[App] Prevented overwriting of valid chatManager instance.');
                }
                return current;              // silently ignore the bad overwrite
            }
        }
        return originalRegister(key, value);
    };
})(DependencySystem);

// Register apiRequest in DependencySystem for clean DI (after DependencySystem is defined)
DependencySystem.register('apiRequest', apiRequest);

// -- DependencySystem Core Module Registration (explicit, DI-compliant) --
const notificationHandler = createNotificationHandler({ DependencySystem });
DependencySystem.register('notificationHandler', notificationHandler);

// Register modal mapping as a DI constant
DependencySystem.register('modalMapping', MODAL_MAPPINGS);

const eventHandlers = createEventHandlers({ DependencySystem });
DependencySystem.register('eventHandlers', eventHandlers);

const auth = createAuthModule({
    DependencySystem,
    apiRequest,
    eventHandlers,
    showNotification: notificationHandler.show
});
DependencySystem.register('auth', auth);


/* ---------------------------------------------------------------------
 * Configuration
 * ------------------------------------------------------------------- */
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

/* ---------------------------------------------------------------------
 * Global App State
 * ------------------------------------------------------------------- */
const appState = {
    initialized: false,
    initializing: false,
    currentPhase: 'idle',
    isAuthenticated: false
};

/* ---------------------------------------------------------------------
 * Header Rendering based on Auth State
 * ------------------------------------------------------------------- */
function renderAuthHeader() {
    try {
        const authMod = DependencySystem.modules.get('auth');
        const isAuth = typeof authMod?.isAuthenticated === 'function' && authMod.isAuthenticated();
        // Auth button
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
        // Status spans
        const authStatus = document.querySelector(APP_CONFIG.SELECTORS.AUTH_STATUS_SPAN);
        const userStatus = document.querySelector(APP_CONFIG.SELECTORS.USER_STATUS_SPAN);
        if (authStatus) {
            authStatus.textContent = isAuth ? 'Signed in' : 'Not signed in';
        }
        if (userStatus) {
            userStatus.textContent = isAuth ? `Hello, ${authMod.getCurrentUser()}` : '';
        }
    } catch (e) {
        console.error('[App] renderAuthHeader error:', e);
    }
}


/* ---------------------------------------------------------------------
 * SPA Router Patch
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
 * Application Instance
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
            // waitFor always returns an array of resolved modules. Destructure to get the instance.
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

// -------------------------------------------------------------------
// ChatManager: Register instance AFTER app is constructed (fixes DI)
// -------------------------------------------------------------------
const chatManager = createChatManager({
    DependencySystem,
    apiRequest,
    auth,
    eventHandlers,
    app,
    isValidProjectId: validateUUID,
    isAuthenticated: () => {
        try {
            return typeof auth?.isAuthenticated === 'function'
                ? auth.isAuthenticated()
                : false;
        } catch (e) {
            return false;
        }
    }
});
// Defensive: ensure real instance, not the factory and has required method
if (
    typeof chatManager !== 'object' ||
    typeof chatManager.initialize !== 'function' ||
    typeof chatManager.loadConversation !== 'function'
) {
    throw new Error('[App] createChatManager() did not return a valid ChatManager instance.');
}
// Only allow instance registration
if (
    typeof chatManager === 'object' &&
    typeof chatManager.loadConversation === 'function'
) {
    DependencySystem.register('chatManager', chatManager);
} else {
    throw new Error('[App] Refusing to register chatManager: not a valid instance with .loadConversation');
}
// Harden: fix if some module or late load registered the factory by accident
let regChatManager = DependencySystem.modules.get('chatManager');
if (regChatManager === createChatManager || typeof regChatManager.loadConversation !== 'function') {
    console.error('[App] ERROR: chatManager registered incorrectly – fixing.');
    DependencySystem.modules.delete('chatManager');
    DependencySystem.register('chatManager', chatManager);
}

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

        appState.currentPhase = 'waiting_core_deps';
        console.log('[App] Waiting for essential dependencies...');
        await waitFor(['auth', 'eventHandlers', 'notificationHandler'], null, APP_CONFIG.TIMEOUTS.DEPENDENCY_WAIT);
        if (APP_CONFIG.DEBUG) {
            console.debug('[App] Essential dependencies loaded.');
        }

        appState.currentPhase = 'init_core_systems';
        await initializeCoreSystems();

        appState.currentPhase = 'init_auth';
        await initializeAuthSystem();

        appState.currentPhase = 'init_ui';
        await initializeUIComponents();

        appState.currentPhase = 'registering_listeners';
        registerAppListeners();

        appState.currentPhase = 'finalizing';
        appState.initialized = true;

        // --- FINAL-PHASE CENTRAL SAFETY NET ---
        try {
            await DependencySystem.modules.get('eventHandlers')?.init?.();
            DependencySystem.modules.get('modelConfig')?.initializeUI?.();
            DependencySystem.modules.get('chatExtensions')?.init?.();
            await DependencySystem.modules.get('projectListComponent')?.initialize?.();
            await DependencySystem.modules.get('projectDetailsComponent')?.initialize?.();
        } catch (err) {
            console.warn('[App] Post-initialization safety net failed:', err);
        }

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

/* ---------------------------------------------------------------------
 * Core Systems Initialization
 * ------------------------------------------------------------------- */
async function initializeCoreSystems() {
    console.log('[App] Initializing core systems...');

    // PHASE 1: Create components and register dependencies (always register constructed instances)
    const modalManager = createModalManager();
    DependencySystem.register('modalManager', modalManager);
    window.modalManager = modalManager;

    // chatManager is already registered above.
    // Defensive: do not re-register in core systems.
    const chatMgrInstance = DependencySystem.modules.get('chatManager');
    if (!chatMgrInstance || typeof chatMgrInstance.initialize !== 'function') {
        throw new Error('[App] chatManager registration: not a valid instance with "initialize".');
    }

    const projectManager = createProjectManager({ DependencySystem, chatManager: chatMgrInstance });
    DependencySystem.register('projectManager', projectManager);
    if (typeof DependencySystem.modules.get('projectManager') === 'function' ||
        typeof projectManager.initialize !== 'function') {
        throw new Error('[App] projectManager registration: not a valid instance with "initialize".');
    }

    const projectModal = createProjectModal();
    DependencySystem.register('projectModal', projectModal);

    // Wait for actual modal HTML to be loaded into the DOM (signaled by base.html)
    const modalsReady = new Promise(resolve =>
        document.addEventListener('modalsLoaded', resolve, { once: true })
    );
    console.log('[App] Waiting for modal HTML to load...');
    await modalsReady;
    console.log('[App] Modal HTML loaded.');

    // PHASE 2: Initialize components in order, *after* dependencies and DOM elements are ready

    if (typeof modalManager.init === 'function') {
        console.log('[App] Initializing ModalManager...');
        modalManager.init();
    } else {
        console.error('[App] modalManager.init function not found!');
    }

    if (typeof chatManager.initialize === 'function') {
        if (appState.isAuthenticated) {
            console.log('[App] Initializing ChatManager (user already authenticated)…');
            await chatManager.initialize();
        } else {
            // Safe to skip here; debounced re-init will occur after login/project change
            console.log('[App] Skipping ChatManager.init – waiting for user authentication.');
        }
    }

    if (typeof projectModal.init === 'function') {
        console.log('[App] Initializing ProjectModal...');
        projectModal.init();
    } else {
        console.error('[App] projectModal.init function not found!');
    }

    if (typeof projectManager.initialize === 'function') {
        console.log('[App] Initializing ProjectManager...');
        await projectManager.initialize();
    }

    const eh = DependencySystem.modules.get('eventHandlers');
    if (typeof eh?.init === 'function') {
        console.log('[App] Initializing EventHandlers...');
        eh.init();
    }

    console.log('[App] Core systems initialized.');
}

/* ---------------------------------------------------------------------
 * Auth System Initialization
 * ------------------------------------------------------------------- */
async function initializeAuthSystem() {
    console.log('[App] Initializing authentication system...');
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
        console.log(`[App] Initial authentication state: ${appState.isAuthenticated}`);
        // Subscribe to future auth state changes to re-render header
        const bus = auth.AuthBus;
        if (bus && typeof bus.addEventListener === 'function') {
            bus.addEventListener('authStateChanged', () => {
                appState.isAuthenticated = auth.isAuthenticated();
                renderAuthHeader();
            });
        }
        // Render initial header UI based on auth state
        renderAuthHeader();
    } catch (err) {
        console.error('[App] Auth system initialization/check failed:', err);
        appState.isAuthenticated = false;
        showNotification(`Authentication check failed: ${err.message}`, 'error');
        throw new Error(`[App] initializeAuthSystem failed: ${err.message}`);
    }
}

/* ---------------------------------------------------------------------
 * UI Components Initialization
 * ------------------------------------------------------------------- */
async function initializeUIComponents() {
    console.log('[App] Initializing UI components...');

    // Centralized login button event binding using eventHandlers.trackListener
    window.setupLoginButtonHandler = function setupLoginButtonHandler(eventHandlers, modalManager) {
        const loginBtn = document.querySelector('#authButton') || document.querySelector('#loginButton');
        if (!loginBtn || !eventHandlers?.trackListener) {
            console.warn('[App] Login button or eventHandlers.trackListener missing, cannot bind login event.');
            return;
        }
        // Remove existing click handlers to prevent double-registration
        loginBtn.replaceWith(loginBtn.cloneNode(true));
        const freshBtn = document.querySelector('#authButton') || document.querySelector('#loginButton');
        eventHandlers.trackListener(freshBtn, 'click', (e) => {
            e.preventDefault();
            // Prefer modal if available
            if (modalManager?.show) {
                modalManager.show('login');
            } else {
                const dropdown = document.querySelector('#authDropdown');
                if (dropdown) dropdown.classList.toggle('hidden');
            }
        }, { description: 'LoginButton: show login form/modal' });
    };

    // Wait until all required deps AND DOM containers are present before proceeding.
    await waitForDepsAndDom({
        deps: ['projectManager', 'eventHandlers', 'modalManager'],
        domSelectors: ['body'],
        DependencySystem
    });

    // --- Inject required static HTML partials for dashboard views before component instantiation ---
    // Ensure #projectListView and #projectDetailsView exist in the DOM
    let projectListView = document.getElementById('projectListView');
    let projectDetailsView = document.getElementById('projectDetailsView');

    // If not present, create containers
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

    // Inject static/html/project_list.html into #projectListView if #projectList is missing
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
                showNotification?.('Static /static/html/project_list.html inject failed (missing #projectList)!', 'error', 10000);
                throw new Error('Injected /static/html/project_list.html but #projectList is still missing! Check the HTML fragment.');
            }
        } catch (err) {
            showNotification?.(`Failed to load project list UI: ${err.message}`, "error", 10000);
            throw err;
        }
    }
    // Inject static/html/project_details.html into #projectDetailsView if #projectDetails isn't present
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
                showNotification?.('Static /static/html/project_details.html inject failed (missing #projectDetails)!', 'error', 10000);
                throw new Error('Injected /static/html/project_details.html but #projectDetails is still missing! Check the HTML fragment.');
            }
        } catch (err) {
            showNotification?.(`Failed to load project details UI: ${err.message}`, "error", 10000);
            throw err;
        }
    }

    const appRef = app;
    const projectManager = DependencySystem.modules.get('projectManager');
    const eventHandlers = DependencySystem.modules.get('eventHandlers');
    const modalManager = DependencySystem.modules.get('modalManager');

    // Initial setup after DOM is injected
    setTimeout(() => {
        window.setupLoginButtonHandler(eventHandlers, modalManager);
    }, 0);

    // Register component classes
    if (FileUploadComponent) {
        DependencySystem.register('FileUploadComponent', FileUploadComponent);
    }

    // Instantiate and register ProjectListComponent
    if (typeof ProjectListComponent === 'function') {
        const projectListComponent = new ProjectListComponent({
            projectManager,
            eventHandlers,
            modalManager,
            app: appRef
        });
        DependencySystem.register('projectListComponent', projectListComponent);
    }

    const FileUploadComponentClass = DependencySystem.modules.get('FileUploadComponent');

    // Create and register chatExtensions
    const chatExtensions = createChatExtensions({ DependencySystem });
    DependencySystem.register('chatExtensions', chatExtensions);

    // Create and register modelConfig
    const modelConfig = createModelConfig();
    DependencySystem.register('modelConfig', modelConfig);

    // Create and register projectDashboardUtils
    const projectDashboardUtils = createProjectDashboardUtils();
    DependencySystem.register('projectDashboardUtils', projectDashboardUtils);

    // Create and register projectDashboard
    // Defensive: Remove any previous incorrect registration of the factory function
    if (DependencySystem.modules.get('projectDashboard') === createProjectDashboard) {
        DependencySystem.modules.delete('projectDashboard');
    }
    const projectDashboard = createProjectDashboard();
    // Debug: Ensure we are registering the instance, not the factory
    console.log('[App] Registered projectDashboard:', projectDashboard);
    console.log('[App] showProjectList:', typeof projectDashboard.showProjectList);
    console.log('[App] showProjectDetails:', typeof projectDashboard.showProjectDetails);
    DependencySystem.register('projectDashboard', projectDashboard);

    // Defensive: Check for duplicate/incorrect registrations
    if (typeof DependencySystem.modules.get('projectDashboard') === 'function' && DependencySystem.modules.get('projectDashboard').name === 'createProjectDashboard') {
        console.error('[App] ERROR: projectDashboard is the factory function, not the instance! Fix registration.');
        // Fix registration immediately if detected
        DependencySystem.modules.delete('projectDashboard');
        DependencySystem.register('projectDashboard', projectDashboard);
    }
    // Assert that the instance has the required methods
    if (
      typeof projectDashboard.showProjectList !== 'function' ||
      typeof projectDashboard.showProjectDetails !== 'function'
    ) {
      throw new Error('[App] projectDashboard instance missing required methods!');
    }

    // Create and register projectDetailsComponent
    const projectDetailsComponent = createProjectDetailsComponent({
        onBack: async () => {
            try {
                const pd = await DependencySystem.waitFor('projectDashboard');
                pd?.showProjectList?.();
            } catch (e) {
                console.error('[App] Error in onBack callback:', e);
                window.location.href = '/';
            }
        },
        app: appRef,
        projectManager,
        eventHandlers,
        FileUploadComponentClass,
        modalManager
    });
    DependencySystem.register('projectDetailsComponent', projectDetailsComponent);

    // Create and register sidebar
    const sidebar = createSidebar({
        DependencySystem,
        eventHandlers,
        app: appRef,
        projectDashboard,
        projectManager
    });
    DependencySystem.register('sidebar', sidebar);

    // Register utility modules
    DependencySystem.register('utils', globalUtils);
    DependencySystem.register('formatting', formatting);
    DependencySystem.register('accessibilityUtils', accessibilityUtils);

    // Create and register knowledgeBaseComponent
    const knowledgeBaseComponent = createKnowledgeBaseComponent({
        DependencySystem,
        apiRequest,
        auth: DependencySystem.modules.get('auth'),
        projectManager,
        showNotification,
        uiUtils: globalUtils
    });
    DependencySystem.register('knowledgeBaseComponent', knowledgeBaseComponent);

    // Initialize components in order
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
        console.log('[App] Initializing ProjectDashboard instance...');
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

    if (appState.isAuthenticated && projectManager?.loadProjects) {
        projectManager.loadProjects('all');
    }

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
function getAuthBus() {
    // Always resolve from DependencySystem's current 'auth' module
    const auth = DependencySystem?.modules?.get('auth');
    return auth?.AuthBus;
}

// Ensure only one AuthBus event attachment across all runtime
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

function registerAppListeners() {
    console.log('[App] Registering global event listeners...');

    // Canonical: Wait for all required modules before attaching event listeners and triggers
    waitFor(['auth', 'chatManager', 'projectManager'], () => {
        attachAuthBusListener('authStateChanged', handleAuthStateChange, '_globalAuthStateChangedAttached');
        setupChatInitializationTrigger();

        // Navigation handler should only run after all dependencies are ready
        window.addEventListener('locationchange', handleNavigationChange);
    }).catch(err => console.error('[App] Failed to wait for dependencies:', err));

    if(APP_CONFIG.DEBUG){
        // Debugging: register a global for runtime AuthBus integrity checking
        window._verifyAuthBus = () => {
            const auth = DependencySystem?.modules?.get('auth');
            console.log('[DEBUG] Auth module:', auth);
            console.log('[DEBUG] AuthBus:', auth?.AuthBus);
            console.log('[DEBUG] All window AuthBus markers:', {
                _globalAuthStateChangedAttached: window._globalAuthStateChangedAttached,
                _globalChatInitAuthAttached: window._globalChatInitAuthAttached
            });
            if (window.LAST_AUTHBUS && auth?.AuthBus && window.LAST_AUTHBUS !== auth.AuthBus) {
                console.error('[DEBUG] AuthBus mismatch detected! Possible overwrite/race condition.');
            }
            window.LAST_AUTHBUS = auth?.AuthBus;
        };
    }

    console.log('[App] Global event listeners registered.');
}

function setupChatInitializationTrigger() {
    const requiredDeps = ['auth', 'chatManager', 'projectManager'];
    // Make debouncedInitChat accept a forced projectId
    const debouncedInitChat = debounce(async (forceProjectId = null) => {
        try {
            const [authMod, chatMgr, pm] = await waitFor(requiredDeps, null, APP_CONFIG.TIMEOUTS.DEPENDENCY_WAIT / 2);

            // Defensive: Ensure dependencies and critical methods exist.
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
            // Prefer explicit forcedParam > then normal param > then pm state
            const finalProjectId =
                  forceProjectId
                  ?? projectId
                  ?? pm?.currentProject?.id
                  ?? null;

            if (authMod.isAuthenticated() && typeof chatMgr.initialize === "function") {
                if (APP_CONFIG.DEBUG) {
                    console.log(`[App] Debounced chat init triggered. Project: ${finalProjectId}`);
                }
                await chatMgr.initialize({ projectId: finalProjectId });
            } else {
                if (APP_CONFIG.DEBUG) {
                    console.log(`[App] Skipping debounced chat init. Auth: ${typeof authMod.isAuthenticated === "function" ? authMod.isAuthenticated() : 'unavailable'}, Project: ${finalProjectId}`);
                }
                chatMgr?.clear?.();
            }
        } catch (err) {
            console.error('[App] Error during debounced chat initialization:', err);
        }
    }, 350);

    waitFor(requiredDeps, deps => {
        // Always attach to the canonical AuthBus; never fallback
        attachAuthBusListener('authStateChanged', debouncedInitChat, '_globalChatInitAuthAttached');

        // projectManager changes are still document-level
        if (!document._chatInitProjListenerAttached) {
            document.addEventListener('currentProjectChanged', debouncedInitChat);
            document._chatInitProjListenerAttached = true;
            if (APP_CONFIG.DEBUG) {
                console.warn('[App] Falling back to document for currentProjectChanged -> chat reinit listener.');
            }
        }
        // NEW: listen for guaranteed project readiness
        document.addEventListener('currentProjectReady',
            e => debouncedInitChat(e.detail?.project?.id));
        console.log('[App] Chat re-initialization listeners attached.');
        debouncedInitChat();
    }, APP_CONFIG.TIMEOUTS.DEPENDENCY_WAIT * 2)
        .catch(err => console.error('[App] Failed setup for chat init triggers:', err));
}

/* ---------------------------------------------------------------------
 * Navigation Logic
 * ------------------------------------------------------------------- */
let lastHandledProj = null;
let lastHandledChat = null;

async function handleNavigationChange() {
    if (!appState.initialized) {
        if (appState.initializing) {
            await new Promise(r => setTimeout(r, 150));
            if (!appState.initialized) {
                console.warn("[App] handleNavigationChange: Aborted, initialization didn't complete.");
                return;
            }
        } else {
            console.warn("[App] handleNavigationChange: Aborted, application not initialized.");
            return;
        }
    }

    const currentUrl = window.location.href;
    console.log(`[App] Handling navigation change. URL: ${currentUrl}`);
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

    // If we're re-navigating to the same project + chat, skip re-init
    if (projectId === lastHandledProj && chatId === lastHandledChat) {
        if (APP_CONFIG.DEBUG) {
            console.log('[App] handleNavigationChange: Same project/chat; skipping re-load.');
        }
        return;
    }

    lastHandledProj = projectId;
    lastHandledChat = chatId;

    if (!appState.isAuthenticated) {
        console.log('[App] Navigation change: User not authenticated.');
        projectDashboard.showLoginRequiredMessage?.();
        return;
    }
    toggleElement('LOGIN_REQUIRED_MESSAGE', false);

    try {
        console.log('[App] projectDashboard:', projectDashboard);
        console.log('[App] showProjectDetails:', typeof projectDashboard.showProjectDetails);
        console.log('[App] showProjectList:', typeof projectDashboard.showProjectList);

        // Patch: Ensure project details are fully loaded before continuing to project UI and chat
        let projectManager;
        try {
            [projectManager] = await waitFor(['projectManager'], null, APP_CONFIG.TIMEOUTS.DEPENDENCY_WAIT);
        } catch (e) {
            console.error('[App] ProjectManager unavailable for navigation:', e);
            showNotification('UI Project Error.', 'error');
            return;
        }

        if (projectId && validateUUID(projectId)) {
            // Load project details and only then show project/dashboard/chat
            console.log(`[App] Ensuring project ${projectId} details are loaded before UI...`);
            await projectManager.loadProjectDetails(projectId);
            if (typeof projectDashboard.showProjectDetails === 'function') {
                console.log(`[App] Navigating to project details: ${projectId}, chatId=${chatId||'none'}`);
                await projectDashboard.showProjectDetails(projectId);
            }
        } else if (typeof projectDashboard.showProjectList === 'function') {
            console.log('[App] Navigating to project list view.');
            await projectDashboard.showProjectList();
        } else {
            console.warn('[App] Unhandled navigation or missing dashboard methods.');
            toggleElement('PROJECT_DETAILS_VIEW', false);
            toggleElement('PROJECT_LIST_VIEW', true);
        }

        // After project is loaded and visible, if chatId exists, safe to trigger chat logic
        if (projectId && validateUUID(projectId) && chatId) {
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

/* ---------------------------------------------------------------------
 * Auth State Change Handler
 * ------------------------------------------------------------------- */
async function handleAuthStateChange(event) {
    const { authenticated, username } = event?.detail || {};
    const newAuthState = !!authenticated;
    if (newAuthState === appState.isAuthenticated) return;

    const previousAuthState = appState.isAuthenticated;
    appState.isAuthenticated = newAuthState;
    console.log(`[App] Auth state changed. Authenticated: ${appState.isAuthenticated}, User: ${username || 'N/A'}`);

    requestAnimationFrame(() => {
        if (APP_CONFIG.DEBUG) {
            console.log('[App] handleAuthStateChange running. Authenticated:', appState.isAuthenticated, 'Username:', username);
        }
        toggleElement(APP_CONFIG.SELECTORS.AUTH_BUTTON, !appState.isAuthenticated);
        toggleElement(APP_CONFIG.SELECTORS.USER_MENU, appState.isAuthenticated);
        const authStatus = document.querySelector(APP_CONFIG.SELECTORS.AUTH_STATUS_SPAN);
        const userStatus = document.querySelector(APP_CONFIG.SELECTORS.USER_STATUS_SPAN);
        if (authStatus) authStatus.textContent = appState.isAuthenticated ? (username ?? 'Authenticated') : 'Not Authenticated';
        if (userStatus) userStatus.textContent = appState.isAuthenticated ? (username ?? '') : '';
        if (APP_CONFIG.DEBUG) console.log('[App] Updated auth UI elements.');
        // Re-bind login button after any UI change that may create it
        const eventHandlers = DependencySystem.modules.get('eventHandlers');
        const modalManager = DependencySystem.modules.get('modalManager');
        setTimeout(() => {
            window.setupLoginButtonHandler(eventHandlers, modalManager);
        }, 0);
    });

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
        console.log('[App] User logged in. Refreshing data/UI.');
        toggleElement('LOGIN_REQUIRED_MESSAGE', false);
        projectDashboard.showProjectList?.();
        if (projectManager.loadProjects) {
            try {
                const projects = await projectManager.loadProjects('all');
                console.log(`[App] Projects loaded after login: ${projects.length}`);
                sidebar.renderProjects?.(projects);
            } catch (err) {
                console.error('[App] Failed to load projects after login:', err);
                showNotification('Failed to load projects.', 'error');
            }
        }
    } else if (!appState.isAuthenticated && previousAuthState) {
        console.log('[App] User logged out. Clearing data/UI.');
        toggleElement('LOGIN_REQUIRED_MESSAGE', true);
        projectManager.currentProject = null;
        localStorage.removeItem('selectedProjectId');
        projectDashboard.showLoginRequiredMessage?.();
        sidebar.clear?.();
        chatManager.clear?.();
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
        showNotification(`Application failed to start: ${error.message}. Please refresh.`, 'error', 15000);
    } catch (e) {
        console.error('[App] Error in showNotification during handleInitError:', e);
    }
    try {
        const container = document.querySelector(APP_CONFIG.SELECTORS.APP_FATAL_ERROR);
        if (container) {
            container.textContent = `Application Error: ${error.message}. Please refresh.`;
            container.classList.remove('hidden');
        } else {
            alert(`Application Critical Error: ${error.message}. Please refresh.`);
        }
    } catch (e) {
        console.error('[App] Error in container query during handleInitError:', e);
    }
    toggleElement('APP_LOADING_SPINNER', false);
}

/* ---------------------------------------------------------------------
 * Application Kick-off
 * ------------------------------------------------------------------- */
function bootstrap() {
    if (window.appBootstrapCalled) return;
    if (!window.DependencySystem) {
        console.error("CRITICAL: DependencySystem not found. Bootstrap aborted.");
        document.body.innerHTML = `
      <div style="padding: 2em; text-align: center; color: red; font-family: sans-serif;">
        <strong>Application Critical Error:</strong> Core dependency system failed to load.
        Please refresh or contact support.
      </div>`;
        return;
    }
    const start = performance.now();
    console.log(`[App] Bootstrapping... (${start.toFixed(2)})`);
    const onReady = () => {
        console.log(`[App] DOM ready. (Delay: ${(performance.now() - start).toFixed(2)} ms)`);
        init().catch(err => console.error("[App] Unhandled error during async init:", err));
    };
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', onReady);
    } else {
        onReady();
    }
}

bootstrap();
