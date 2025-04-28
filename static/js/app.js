/* ----------------------------------------------------------------------
 *  app.js - REMEDIATED 2025-04-27
 * ----------------------------------------------------------------------
 *  - Robust, deterministic API-request layer
 *  - Hardened dependency-registration & auth flow
 *  - Debounced chat (re)initialisation
 *  - SPA router now tracks pushState / replaceState
 *  - Misc. security-, performance- and DX-improvements
 * -------------------------------------------------------------------- */

import './auth.js';
import { createModalManager, createProjectModal } from './modalManager.js';
import { createProjectManager } from './projectManager.js';
import { createProjectDashboard } from './projectDashboard.js';
import { createProjectListComponent, ProjectListComponent } from './projectListComponent.js';
import { createProjectDetailsComponent } from './projectDetailsComponent.js';
import { createSidebar } from './sidebar.js';
import { createModelConfig } from './modelConfig.js';
import { createProjectDashboardUtils } from './projectDashboardUtils.js';
import './FileUploadComponent.js';
import './notification-handler.js';
import './sidebar-enhancements.js';
import { createChatManager } from './chat.js';
import { createKnowledgeBaseComponent } from './knowledgeBaseComponent.js';
import { initChatExtensions } from './chatExtensions.js';

/* ---------------------------------------------------------------------
 * Configuration
 * ------------------------------------------------------------------- */

const APP_CONFIG = {
    DEBUG:
        window.location.hostname === 'localhost' ||
        window.location.search.includes('debug=1'),

    TIMEOUTS: {
        INITIALIZATION: 10_000,
        AUTH_CHECK: 5_000,
        API_REQUEST: 8_000,
        COMPONENT_LOAD: 5_000
    },

    API_ENDPOINTS: {
        AUTH_VERIFY: '/api/auth/verify/',
        PROJECTS: '/api/projects/',
        PROJECT_DETAILS: '/api/projects/{projectId}/'
    },

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

/* ---------------------------------------------------------------------
 * Global App State
 * ------------------------------------------------------------------- */

const appState = {
    initialized: false,
    initializing: true,
    currentPhase: 'boot',
    currentView: null,
    isAuthenticated: false
};

/* ---------------------------------------------------------------------
 * Small utility helpers (no external deps)
 * ------------------------------------------------------------------- */

/** Recursively serialises JS objects with stable key order. */
function stableStringify(value) {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
    return `{${Object.keys(value)
        .sort()
        .map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`)
        .join(',')}}`;
}

/** Normalises URLs so query-string order does not affect cache keys. */
function normaliseUrl(url) {
    const u = new URL(url, window.location.origin);
    // Sort params
    const params = Array.from(u.searchParams.entries()).sort(([a], [b]) =>
        a.localeCompare(b)
    );
    u.search = new URLSearchParams(params).toString();
    return u.toString();
}

/** Simple debounce (leading=false, trailing=true). */
function debounce(fn, wait = 250) {
    let t;
    return function (...args) {
        clearTimeout(t);
        t = setTimeout(() => fn.apply(this, args), wait);
    };
}

/* ---------------------------------------------------------------------
 * In-flight request deduplication map
 * ------------------------------------------------------------------- */
const pendingRequests = new Map();

/* ---------------------------------------------------------------------
 * Robust API request (CSRF, timeout, dedup v2)
 * ------------------------------------------------------------------- */
async function apiRequest(url, opts = {}, skipCache = false) {
    const method = (opts.method || 'GET').toUpperCase();
    const unsafeVerb = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);

    // Build deterministic request key
    const bodyKey =
        opts.body instanceof FormData
            ? '[form-data]'
            : stableStringify(opts.body || {});
    const requestKey = `${method}-${normaliseUrl(url)}-${bodyKey}`;

    if (!skipCache && pendingRequests.has(requestKey)) {
        return pendingRequests.get(requestKey);
    }

    // Ensure headers object
    opts.headers = opts.headers ? { ...opts.headers } : {};

    // CSRF header only for unsafe requests
    if (unsafeVerb) {
        const csrf = window.auth?.getCSRFToken?.();
        if (csrf) opts.headers['X-CSRF-Token'] = csrf;
    }

    // Auto-set content-type for JSON bodies
    if (
        unsafeVerb &&
        opts.body &&
        typeof opts.body === 'object' &&
        !(opts.body instanceof FormData)
    ) {
        if (!opts.headers['Content-Type']) {
            opts.headers['Content-Type'] = 'application/json';
        }
        opts.body = JSON.stringify(opts.body);
    }

    // Timeout via AbortController
    const controller = new AbortController();
    const timer = setTimeout(
        () => controller.abort(),
        APP_CONFIG.TIMEOUTS.API_REQUEST
    );
    opts.signal = controller.signal;

    const reqPromise = (async () => {
        try {
            const resp = await fetch(url, opts);

            if (!resp.ok) {
                // Attempt to parse JSON error payload
                let errPayload = {};
                try {
                    errPayload = await resp.clone().json();
                } catch {
                    /* ignore */
                }
                const error = new Error(
                    errPayload.message ||
                    `API request failed with status ${resp.status}`
                );
                error.status = resp.status;
                error.data = errPayload;
                throw error;
            }

            // Auto parse JSON responses
            if (resp.headers.get('content-type')?.includes('application/json')) {
                return await resp.json();
            }
            return await resp.text();
        } catch (e) {
            if (e.name === 'AbortError') {
                throw new Error(
                    `API request timed out after ${APP_CONFIG.TIMEOUTS.API_REQUEST} ms`
                );
            }
            throw e;
        } finally {
            clearTimeout(timer);
            if (!skipCache) pendingRequests.delete(requestKey);
        }
    })();

    if (!skipCache) pendingRequests.set(requestKey, reqPromise);
    return reqPromise;
}

/* ---------------------------------------------------------------------
 * Dependency / Event helpers
 * ------------------------------------------------------------------- */

const waitFor = window.DependencySystem.waitFor.bind(window.DependencySystem);

/* ---------------------------------------------------------------------
 * SPA router – fires on pushState / replaceState as well
 * ------------------------------------------------------------------- */
(() => {
    const rawPush = history.pushState;
    const rawReplace = history.replaceState;
    function fire() {
        window.dispatchEvent(new Event('locationchange'));
    }
    history.pushState = function (...a) {
        rawPush.apply(this, a);
        fire();
    };
    history.replaceState = function (...a) {
        rawReplace.apply(this, a);
        fire();
    };
    window.addEventListener('popstate', fire);
})();

/* ---------------------------------------------------------------------
 * UUID validation helper (version 1-5, non-nil)
 * ------------------------------------------------------------------- */
function validateUUID(uuid) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        uuid
    );
}

/* ---------------------------------------------------------------------
 * App initialisation sequence
 * ------------------------------------------------------------------- */

/* exported for other modules via DependencySystem */
async function init() {
    if (window.projectDashboardInitialized) {
        if (APP_CONFIG.DEBUG) console.info('[App] Already initialised');
        return true;
    }

    try {
        // phase 1 – core deps
        await waitFor(
            ['auth', 'eventHandlers'],
            null,
            APP_CONFIG.TIMEOUTS.INITIALIZATION
        );

        window.app = {
            apiRequest,
            navigateToConversation,
            showNotification,
            state: appState,
            initialize: init,
            loadProjects,
            getProjectId() {
                const urlParams = new URLSearchParams(window.location.search);
                return (
                    urlParams.get('project') || localStorage.getItem('selectedProjectId')
                );
            },
            validateUUID
        };
        // Security: Lock down window.app after assignment
        Object.defineProperty(window, "app", { writable: false, configurable: false });
        DependencySystem.register('app', window.app);
        if (APP_CONFIG.DEBUG) console.debug('[App] app module registered');

        await initializeCoreSystems();
        await initializeAuthSystem();
        await initializeUIComponents();

        appState.currentPhase = 'initialized';
        appState.initialized = true;
        window.projectDashboardInitialized = true;
        if (APP_CONFIG.DEBUG) console.info('[App] Init complete');
    } catch (err) {
        handleInitError(err);
    } finally {
        appState.initializing = false;
        document.getElementById('appLoading')?.classList.add('hidden');
        document.dispatchEvent(new CustomEvent('appInitialized'));
    }
}

/* ------------------------------------------------------------------- */
/* Core-system init                                                    */
/* ------------------------------------------------------------------- */

async function initializeCoreSystems() {
    if (APP_CONFIG.DEBUG) console.debug('[App] init core systems');

    const modalManager = createModalManager();
    DependencySystem.register('modalManager', modalManager);

    document.addEventListener(
        'modalsLoaded',
        async () => {
            const projectModal = createProjectModal();
            await projectModal.init();
            DependencySystem.register('projectModal', projectModal);
        },
        { once: true }
    );

    await waitFor('eventHandlers', null, 5_000);

    // Notification handler
    if (window.notificationHandler) {
        DependencySystem.register('notificationHandler', window.notificationHandler);
    }

    // Project manager
    const projectManager = createProjectManager();
    await projectManager.initialize();
    DependencySystem.register('projectManager', projectManager);
    window.projectManager = projectManager; // legacy glue
    // Security: Lock down window.projectManager after assignment
    Object.defineProperty(window, "projectManager", { writable: false, configurable: false });
}

/* ------------------------------------------------------------------- */
/* Auth init                                                            */
/* ------------------------------------------------------------------- */

async function initializeAuthSystem() {
    await waitFor(
        'auth',
        async (auth) => {
            try {
                await auth.init?.();
                appState.isAuthenticated = auth.isAuthenticated();
            } catch (err) {
                console.error('[Auth] init failed:', err);
                appState.isAuthenticated = false;
            }
        },
        APP_CONFIG.TIMEOUTS.AUTH_CHECK
    );
}

/* ------------------------------------------------------------------- */
/* UI component init                                                    */
/* ------------------------------------------------------------------- */

async function initializeUIComponents() {
    if (!window.projectDashboard) {
        const { createProjectDashboard } = await import('./projectDashboard.js');
        window.projectDashboard = createProjectDashboard();
        // Security: Lock down window.projectDashboard after assignment
        Object.defineProperty(window, "projectDashboard", { writable: false, configurable: false });
        DependencySystem.register('projectDashboard', window.projectDashboard);
    }

    // Misc enhancements (optional)
    window.initAccessibilityEnhancements?.();
    window.initSidebarEnhancements?.();

    // Initialize the dashboard AFTER other components might be registered
    // The dashboard will now handle initializing ProjectListComponent internally
    await window.projectDashboard.initialize?.();

    const modelConfig = createModelConfig();
    DependencySystem.register('modelConfig', modelConfig);

    const projectDashboardUtils = createProjectDashboardUtils();
    DependencySystem.register('projectDashboardUtils', projectDashboardUtils);

    if (window.FileUploadComponent) {
        DependencySystem.register('FileUploadComponent', window.FileUploadComponent);
    }

    /* ---------- Chat manager with debounce to avoid flood ---------- */
    const chatManager = createChatManager();
    chatManager.initialize = debounce(chatManager.initialize.bind(chatManager), 300);
    DependencySystem.register('chatManager', chatManager);

    window.chatManager = chatManager;
    // Security: Lock down window.chatManager after assignment
    Object.defineProperty(window, "chatManager", { writable: false, configurable: false });
    initChatExtensions();

    /* Project details component */
    const projectDetailsComponent = createProjectDetailsComponent({
        onBack: () => {
            window.projectDashboard?.showProjectList?.() || (window.location.href = '/');
        }
    });
    await projectDetailsComponent.initialize();
    DependencySystem.register('projectDetailsComponent', projectDetailsComponent);

    /* Sidebar */
    const sidebar = createSidebar();
    await sidebar.init();
    DependencySystem.register('sidebar', sidebar);

    /* Knowledge base */
    const knowledgeBaseComponent = createKnowledgeBaseComponent({
        apiRequest,
        auth: window.auth,
        projectManager: window.projectManager,
        showNotification,
        uiUtilsInstance: window.uiUtilsInstance
    });
    DependencySystem.register('knowledgeBaseComponent', knowledgeBaseComponent);

    if (window.app.state.isAuthenticated) {
        await window.chatManager.initialize({
            containerSelector: "#globalChatUI",
            inputSelector: "#chatUIInput",
            sendButtonSelector: "#globalChatSendBtn",
            titleSelector: "#chatTitle"
        });
    }
    handleNavigationChange();
    registerAppListeners();
}

/* ------------------------------------------------------------------- */
/* Utility functions                                                    */
/* ------------------------------------------------------------------- */

function toggleElement(selectorOrElement, show) {
    const el =
        typeof selectorOrElement === 'string'
            ? document.querySelector(
                APP_CONFIG.SELECTORS[selectorOrElement] || selectorOrElement
            )
            : selectorOrElement;
    el?.classList.toggle('hidden', !show);
}

function showNotification(message, type = 'info', duration = 5_000) {
    if (window.notificationHandler?.show) {
        window.notificationHandler.show(message, type, { timeout: duration });
    } else if (
        typeof window.showNotification === 'function' &&
        window.showNotification !== showNotification
    ) {
        window.showNotification(message, type, { timeout: duration });
    } else if (APP_CONFIG.DEBUG) {
        console.log(`[${type.toUpperCase()}] ${message}`);
    }
}

/* ------------------------------------------------------------------- */
/* Navigation / routing                                                 */
/* ------------------------------------------------------------------- */

async function handleNavigationChange() {
    const url = new URL(window.location.href);
    const chatId = url.searchParams.get('chatId');
    const view = url.searchParams.get('view');
    const projectId = url.searchParams.get('project');

    if (!appState.isAuthenticated) {
        toggleElement('LOGIN_REQUIRED_MESSAGE', true);
        toggleElement('PROJECT_LIST_VIEW', false);
        toggleElement('PROJECT_DETAILS_VIEW', false);
        return;
    }
    toggleElement('LOGIN_REQUIRED_MESSAGE', false);

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
        window.projectDashboard.showProjectList();
        return;
    }

    // Fallback when no projectDashboard
    showProjectListView();
}

function showProjectListView() {
    toggleElement('PROJECT_DETAILS_VIEW', false);
    toggleElement('PROJECT_LIST_VIEW', true);
    if (appState.isAuthenticated) loadProjects().catch(console.error);
}

/* Observe URL changes */
window.addEventListener('locationchange', handleNavigationChange);

/* ------------------------------------------------------------------- */
/* Conversation navigation                                              */
/* ------------------------------------------------------------------- */
async function navigateToConversation(conversationId) {
    try {
        return await window.chatManager.loadConversation(conversationId);
    } catch (err) {
        console.error('[Chat] navigation error:', err);
        showNotification('Failed to load conversation', 'error');
        throw err;
    }
}

/* ------------------------------------------------------------------- */
/* Projects                                                             */
/* ------------------------------------------------------------------- */
async function loadProjects() {
    if (!appState.isAuthenticated) return [];
    try {
        return await window.projectManager?.loadProjects?.('all');
    } catch (err) {
        console.error('[App] loadProjects failed:', err);
        return [];
    }
}

/* ------------------------------------------------------------------- */
/* Auth state listener                                                  */
/* ------------------------------------------------------------------- */
waitFor('auth', (auth) => {
    if (!auth?.AuthBus || auth.AuthBus._hasListener) return;
    auth.AuthBus.addEventListener('authStateChanged', handleAuthStateChange);
    auth.AuthBus._hasListener = true;
});

function handleAuthStateChange(event) {
    const { authenticated, username } = event.detail ?? {};
    appState.isAuthenticated = authenticated;

    requestAnimationFrame(() => {
        const authButton = document.querySelector(APP_CONFIG.SELECTORS.AUTH_BUTTON);
        const userMenu = document.querySelector(APP_CONFIG.SELECTORS.USER_MENU);
        const authStatusSpan = document.getElementById('authStatus');
        const userStatusSpan = document.getElementById('userStatus');

        if (authenticated) {
            authButton?.classList.add('hidden');
            userMenu?.classList.remove('hidden');
            authStatusSpan && (authStatusSpan.textContent = username ?? 'Authenticated');
            if (userStatusSpan) {
                userStatusSpan.textContent = 'Online';
                userStatusSpan.classList.replace('text-error', 'text-success');
            }
        } else {
            authButton?.classList.remove('hidden');
            userMenu?.classList.add('hidden');
            authStatusSpan && (authStatusSpan.textContent = 'Not Authenticated');
            if (userStatusSpan) {
                userStatusSpan.textContent = 'Offline';
                userStatusSpan.classList.replace('text-success', 'text-error');
            }
        }
    });

    // Refresh project lists in sidebar (and grid, if needed) after authentication state changes
    if (authenticated && window.projectManager?.loadProjects) {
        window.projectManager.loadProjects('all').then(projects => {
            // Sidebar project list
            const sidebar = window.DependencySystem?.modules.get('sidebar');
            if (sidebar?.renderProjects && Array.isArray(projects)) {
                sidebar.renderProjects(projects);
            }
            // Optionally, refresh other project UIs here if not already tightly wired
        }).catch((err) => {
            // Show error, but do not break auth flow
            if (window.app?.showNotification) {
                window.app.showNotification('Failed to load projects after login', 'error');
            } else {
                console.error('Failed to load projects after login', err);
            }
        });
    }
}
DependencySystem.register('handleAuthStateChange', handleAuthStateChange);

/* ------------------------------------------------------------------- */
/* Global listeners                                                     */
/* ------------------------------------------------------------------- */
function registerAppListeners() {
    window.addEventListener('popstate', handleNavigationChange);
    /* re-init chat on auth or project change */
    waitFor(['auth', 'chatManager'], (auth, chatManager) => {
        const maybeInitChat = debounce(() => {
            if (auth.isAuthenticated() && window.app.getProjectId()) {
                chatManager.initialize({
                    containerSelector: "#globalChatUI",
                    inputSelector: "#chatUIInput",
                    sendButtonSelector: "#globalChatSendBtn",
                    titleSelector: "#chatTitle"
                });
            }
        }, 300);

        auth.AuthBus?.addEventListener('authStateChanged', maybeInitChat);
        waitFor('projectManager', (pm) => {
            const handler = maybeInitChat;
            if (typeof pm.addEventListener === 'function') {
                pm.addEventListener('projectSelected', handler);
            } else if (typeof pm.on === 'function') {
                pm.on('projectSelected', handler);
            } else {
                document.addEventListener('projectSelected', handler);
            }
        });
    });
}

/* ------------------------------------------------------------------- */
/* Fatal init error handler                                             */
/* ------------------------------------------------------------------- */
function handleInitError(error) {
    console.error('[App] Critical init error:', error);
    showNotification('Application failed to initialise – please refresh', 'error');
}

/* ------------------------------------------------------------------- */
/* Kick-off                                                             */
/* ------------------------------------------------------------------- */
if (document.readyState !== 'loading') {
    init().catch(handleInitError);
} else {
    document.addEventListener('DOMContentLoaded', () => {
        init().catch(handleInitError);
    });
}
