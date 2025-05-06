/**
 * Updated application script
 * - Replaced separate browserAPI, apiClient, and storageService imports
 *   with a single import from globalUtils.js
 */

/**
 * Sentry browser integration (Advanced DI pattern)
 * Uses createSentryManager from sentry-init.js for strict DI, dynamic config, and robust teardown.
 * Make sure to inject correct DSN via config/env!
 */
import { createSentryManager } from './sentry-init.js';

/* === STRICT MODULE INIT ORDER: browserAPI → DependencySystem → Sentry/Notification/etc. === */

// ────────────── Core config, utilities, no dependencies yet ──────────────
const sentryConfig = {
  dsn: 'https://your_sentry_dsn_here@sentry.io/project-id', // TODO: Inject real DSN by build/runtime config
  environment: 'production',
  release: 'frontend-app@1.0.0',
  sampleRates: { traces: 1.0, replaysSession: 0.0, replaysOnError: 1.0 }
};

const sentryEnv = {};
const domAPI = {
  createElement: tag => document.createElement(tag),
  addEventListener: (...args) => (args[0]?.addEventListener ? args[0].addEventListener(...args.slice(1)) : undefined),
  removeEventListener: (...args) => (args[0]?.removeEventListener ? args[0].removeEventListener(...args.slice(1)) : undefined),
  appendChild: (parent, child) => parent && child && parent.appendChild(child),
};
const storage = window.localStorage;
const notification = { log(){}, warn(){}, error(){} };   // placeholder (no longer uses console)
const sentryNamespace = typeof window !== 'undefined' && window.Sentry
  ? window
  : { Sentry: undefined };

let notify = null;

// ────────────── 1. Construct browserAPI & DependencySystem before DI usage ──────────────
import * as globalUtils from './utils/globalUtils.js';

// Register browserService with DependencySystem
import { createBrowserService } from './utils/browserService.js';

const browserAPI = globalUtils.createBrowserAPI();
let DependencySystem = browserAPI.getDependencySystem();
if (!DependencySystem) {
  // UI fallback only: notification unavailable before DI
  document.body.innerHTML = `
    <div style="padding: 2em; text-align: center; color: red; font-family: sans-serif;">
      <strong>Application Critical Error:</strong> Core dependency system failed to load.<br>
      Please contact support or refresh.
    </div>`;
  throw new Error("DependencySystem is required but not available.");
}
DependencySystem.register('browserAPI', browserAPI);
// Register browserService for robust URL & browser helpers (DI strict)
DependencySystem.register('browserService', createBrowserService({ windowObject: window }));
const waitFor = DependencySystem.waitFor.bind(DependencySystem);

// ────────────── 2. Only now (after DependencySystem is ready), set up Sentry ──────────────
const sentryManager = createSentryManager({
  config: sentryConfig,
  env: sentryEnv,
  domAPI,
  storage,
  notification,
  navigator: window.navigator,
  window,
  document,
  sentryNamespace
});
sentryManager.initialize();
DependencySystem.register('sentryManager', sentryManager);

// ────────────── 3. Now proceed with all DI-based registrations (notification, etc.) ──────────────

import { createEventHandlers } from './eventHandler.js';
import { createChatManager } from './chat.js';
import { createNotificationHandler } from './notification-handler.js';
import { createNotify } from './utils/notify.js';
import { createModalManager } from './modalManager.js';
import { createAuthModule } from './auth.js';
import { createProjectManager } from './projectManager.js';
import { createProjectModal } from './modalManager.js';
import { createChatExtensions } from './chatExtensions.js';
import { createModelConfig } from './modelConfig.js';
import { createProjectDashboardUtils } from './projectDashboardUtils.js';
import { ProjectListComponent } from './projectListComponent.js';
import { createProjectDashboard } from './projectDashboard.js';
import { createProjectDetailsComponent } from './projectDetailsComponent.js';
import { createSidebar } from './sidebar.js';
import { createKnowledgeBaseComponent } from './knowledgeBaseComponent.js';
import MODAL_MAPPINGS from './modalConstants.js';
import { FileUploadComponent } from './FileUploadComponent.js';
// ...rest of file continues unchanged...

// Global error logging now handled by sentry-init.js: see createSentryManager/attachGlobalSentryHandlers.
// Local app config & state
// ---------------------------------------------------------------------
const browserAPIFromDS = DependencySystem.modules?.get('browserAPI');
const _location = browserAPIFromDS?.getLocation ? browserAPIFromDS.getLocation() : browserAPI.getLocation();
const API_ENDPOINTS = {
    AUTH_LOGIN: '/api/auth/login',
    AUTH_REGISTER: '/api/auth/register',
    AUTH_LOGOUT: '/api/auth/logout',
    AUTH_VERIFY: '/api/auth/verify',
    AUTH_CSRF: '/api/auth/csrf', // ADDED CSRF endpoint
    PROJECTS: '/api/projects',
    PROJECT_DETAILS: '/api/projects/{projectId}',
    PROJECT_CONVERSATIONS: '/api/projects/{projectId}/conversations',
    PROJECT_FILES: '/api/projects/{projectId}/files',
    PROJECT_ARTIFACTS: '/api/projects/{projectId}/artifacts',
    PROJECT_KNOWLEDGE_BASE: '/api/projects/{projectId}/knowledge_base'
};
DependencySystem.register('apiEndpoints', API_ENDPOINTS);

const APP_CONFIG = {
    DEBUG: _location.hostname === 'localhost' || _location.search.includes('debug=1'),
    TIMEOUTS: {
        INITIALIZATION: 15000,
        AUTH_CHECK: 5000,
        API_REQUEST: 10000,
        COMPONENT_LOAD: 5000,
        DEPENDENCY_WAIT: 10000
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
let apiRequest;  // We'll set this after our notification handler is ready

import { fetchCurrentUser } from './auth.js';

appState.currentPhase = 'create_event_handlers';
if (APP_CONFIG.DEBUG) {
    notify?.debug?.('[App] Phase: create_event_handlers', { phase: appState.currentPhase, timestamp: performance.now() });
}

let notificationHandler, eventHandlers;
try {
    // Create and register notificationHandler and notify before eventHandlers
    notificationHandler = createNotificationHandler({
        eventHandlers: undefined, // eventHandlers not yet available
        DependencySystem,
        domAPI: {
            getElementById: id => document.getElementById(id),
            createElement: tag => document.createElement(tag),
            createTemplate: html => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t; },
            body: document.body
        },
        groupWindowMs: 7000
    });
    DependencySystem.register('notificationHandler', notificationHandler);
    notify = createNotify({ notificationHandler });
    notify = notify.withContext({ context: 'app', module: 'App' });
    DependencySystem.register('notify', notify);

    // Now create eventHandlers with notify DI
    eventHandlers = createEventHandlers({ DependencySystem, notify });
    DependencySystem.register('eventHandlers', eventHandlers);
} catch (err) {
    // Fallback that always throws if used
    eventHandlers = {
        trackListener: () => { throw new Error("[App] eventHandlers unavailable due to error during initialization: " + err.message); },
        init: () => { throw new Error("[App] eventHandlers unavailable due to error during initialization: " + err.message); }
    };
    DependencySystem.register('eventHandlers', eventHandlers);
    // No DI/notify available yet, fallback UI only for catastrophic error
    globalUtils.toggleElement(APP_CONFIG.SELECTORS.APP_LOADING_SPINNER, false);
    if (typeof document !== "undefined") {
        document.body.innerHTML =
            `<div style="padding: 2em; color: red; font-family: sans-serif;">
         <strong>Application Error:</strong> ${err.message}<br>
         <span>Please contact support or refresh.</span>
        </div>`;
    }
    throw err;
}

 // notificationHandlerWithLog declared earlier.

DependencySystem.register('modalMapping', MODAL_MAPPINGS);

function createErrorReporter() {
    return {
        capture: (err, context = {}) => {
            if (APP_CONFIG.DEBUG) {
                // Always get notify from DI at call time
                const notify = DependencySystem.modules.get('notify');
                if (notify && typeof notify.error === 'function') {
                    const moduleLabel = context.module || "app";
                    const msg = `[${moduleLabel}] ${(context.method || 'error')}: ${err.message || err}`;
                    notify.error(msg, { group: true, context: moduleLabel });
                }
            }
        }
    };
}

const errorReporter = createErrorReporter();
DependencySystem.register('errorReporter', errorReporter);

const app = {
    apiRequest,
    validateUUID: globalUtils.isValidProjectId,
    get state() {
        return { ...appState };
    },
    getProjectId() {
        const browserAPI = DependencySystem.modules.get('browserAPI');
        const currentUser = browserAPI.getCurrentUser?.();
        if (currentUser && currentUser.preferences && currentUser.preferences.last_project_id) {
            return currentUser.preferences.last_project_id;
        }
        try {
            const urlParams = browserAPI.createURLSearchParams?.(browserAPI.getLocation()?.search || "");
            const urlProjectId = urlParams.get('project');
            if (
                urlProjectId &&
                globalUtils.isValidProjectId(urlProjectId) &&
                currentUser &&
                Array.isArray(currentUser.preferences?.projects) &&
                currentUser.preferences.projects.some(p => p.id === urlProjectId)
            ) {
                return urlProjectId;
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
                notify.warn(`[App] navigateToConversation: chatManager reported failure loading ${conversationId}`);
            }
            return success;
        } catch (err) {
            const notify = DependencySystem.modules.get('notify');
            notify?.error?.('[App] navigateToConversation error: ' + (err?.message || err), { group: true, context: "app" });
            notify?.error?.(`Failed to load conversation: ${err.message}`, { group: true, context: "app" });
            return false;
        }
    },
    config: Object.freeze({
        timeouts: { ...APP_CONFIG.TIMEOUTS },
        selectors: { ...APP_CONFIG.SELECTORS },
        debug: APP_CONFIG.DEBUG
    })
};
DependencySystem.register('app', app);

// ---------------------------------------------------------------------
// Register sanitizer and storage services using globalUtils
// ---------------------------------------------------------------------
import DOMPurify from './vendor/dompurify.es.js';
DependencySystem.register('sanitizer', DOMPurify);
DependencySystem.register('DOMPurify', DOMPurify);

// Instead of import { createStorageService } from './utils/storageService.js';
// Use globalUtils.createStorageService
const storageService = globalUtils.createStorageService({
    browserAPI,
    APP_CONFIG,
    notificationHandler: notify
});
DependencySystem.register('storage', storageService);

// Patch chatManager overwrites
(function patchDependencySystem(ds) {
    const originalRegister = ds.register.bind(ds);
    ds.register = function (key, value) {
        if (key === 'chatManager' && ds.modules.has('chatManager')) {
            const current = ds.modules.get('chatManager');
            if (current && typeof current.loadConversation === 'function') {
                if (APP_CONFIG.DEBUG) {
                    notify.warn('[App] Prevented overwriting of valid chatManager instance.');
                }
                return current;
            }
        }
        return originalRegister(key, value);
    };
})(DependencySystem);


let currentUser = null;

// ---------------------------------------------------------------------
// Bootstrap & application initialization
// ---------------------------------------------------------------------
async function bootstrap() {
    const docRef = browserAPI.getDocument();
    if (docRef.readyState === 'loading') {
        eventHandlers.trackListener(
            docRef,
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

function onReady() {
    if (APP_CONFIG.DEBUG && notify) {
        notify.debug(`[App] DOM ready. Starting init...`, { phase: 'onReady', timestamp: performance.now(), location: window.location.href });
        if (window.currentUser) {
            notify.debug("[App] Current user loaded from auth.js:", window.currentUser, { phase: 'onReady' });
        }
    }
    const startTime = performance.now();
    init()
    .then(() => {
        const duration = performance.now() - startTime;
        if (APP_CONFIG.DEBUG && notify) {
            notify.info(`[App] init() resolved successfully in ${duration.toFixed(2)} ms`, { phase: 'onReady', duration });
        }
    })
    .catch(err => {
        const duration = performance.now() - startTime;
        if (notify) {
            notify.error("[App] Unhandled error during async init:", err, { phase: 'onReady', duration, errorStack: err?.stack });
        }
    });
}

async function init() {
    const _initStart = performance.now();
    if (appState.initialized || appState.initializing) {
        if (APP_CONFIG.DEBUG) {
            notify?.info?.('[App] Initialization attempt skipped (already done or in progress).', { phase: 'init', initializing: appState.initializing, initialized: appState.initialized, timestamp: performance.now() });
        }
        return appState.initialized;
    }
    // ADD LOGGING HERE
    // console.log('[App Debug] START init function');
    // console.log('[App Debug] Creating Notification Handler...');
    const notificationHandler = createNotificationHandler({
        eventHandlers,
        DependencySystem,
        domAPI: {
            getElementById: id => document.getElementById(id),
            createElement: tag => document.createElement(tag),
            createTemplate: html => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t; },
            body: document.body
        },
        groupWindowMs: 7000
    });
    DependencySystem.register('notificationHandler', notificationHandler);
    notify = createNotify({ notificationHandler });
    DependencySystem.register('notify', notify);
    // Contexto canónico para todo el archivo
    notify = notify.withContext({ context: 'app', module: 'App' });

    if (APP_CONFIG.DEBUG) notify.debug('[App Debug] START init function', { context: 'app', module: 'App', source: 'init' });
    if (APP_CONFIG.DEBUG) notify.debug('[App Debug] Creating Notification Handler...', { context: 'app', module: 'App', source: 'init' });
    if (APP_CONFIG.DEBUG) notify.debug('[App Debug] Notification Handler CREATED.', { context: 'app', module: 'App', source: 'init' });
    if (APP_CONFIG.DEBUG) notify.debug('[App Debug] Creating Notify Util...', { context: 'app', module: 'App', source: 'init' });
    if (APP_CONFIG.DEBUG) notify.debug('[App Debug] Notify Util CREATED.', { context: 'app', module: 'App', source: 'init' });


// ADD LOGGING HERE
// console.log('[App Debug] Creating API Client...');
if (APP_CONFIG.DEBUG) notify.debug('[App Debug] Creating API Client...', { context: 'app', module: 'App', source: 'init' });

    apiRequest = globalUtils.createApiClient({
        APP_CONFIG,
        globalUtils,
        notificationHandler: notify,
        getAuthModule: () => DependencySystem.modules.get('auth'),
        browserAPI
    });
    if (APP_CONFIG.DEBUG) notify.debug('[App Debug] API Client CREATED.', { context: 'app', module: 'App', source: 'init' });
    DependencySystem.register('apiRequest', apiRequest);
    app.apiRequest = apiRequest;

    // ADD LOGGING HERE
    if (APP_CONFIG.DEBUG) notify.debug('[App Debug] Creating Chat Manager...', { context: 'app', module: 'App', source: 'init' });

    const chatBrowserAPI = DependencySystem.modules.get('browserAPI');
    const chatManager = createChatManager({
        DependencySystem,
        apiRequest,
        auth: () => DependencySystem.modules.get('auth'),
        eventHandlers,
        app,
        domAPI: {
            querySelector: (selector) => chatBrowserAPI.getDocument().querySelector(selector),
            getElementById: (id) => chatBrowserAPI.getDocument().getElementById(id),
            querySelectorAll: (selector) => chatBrowserAPI.getDocument().querySelectorAll(selector),
            appendChild: (parent, child) => parent && child && parent.appendChild(child),
            replaceChildren: (parent, ...children) => parent && parent.replaceChildren(...children),
            createElement: (tag) => chatBrowserAPI.getDocument().createElement(tag),
            removeChild: (parent, child) => parent && parent.removeChild(child),
            setInnerHTML: (el, html) => { if (el) el.innerHTML = html; }
        },
        navAPI: {
            getSearch: () => chatBrowserAPI.getLocation().search,
            getHref: () => chatBrowserAPI.getLocation().href,
            pushState: (url) => chatBrowserAPI.getHistory().pushState({}, '', url),
            getPathname: () => chatBrowserAPI.getLocation().pathname
        },
        isValidProjectId: globalUtils.isValidProjectId,
        isAuthenticated: () => {
            try {
                const authModule = DependencySystem.modules.get('auth');
                return typeof authModule?.isAuthenticated === 'function'
                    ? authModule.isAuthenticated()
                    : false;
            } catch (e) {
                notify?.warn?.('[App] Error checking isAuthenticated during ChatManager DI', e, { phase: 'init' });
                return false;
            }
        },
        DOMPurify: DependencySystem.modules.get('sanitizer'),
        apiEndpoints: DependencySystem.modules.get('apiEndpoints') // ADDED THIS LINE
    });
    // ADD LOGGING HERE
    if (APP_CONFIG.DEBUG) notify.debug('[App Debug] Chat Manager CREATED.', { context: 'app', module: 'App', source: 'init' });
    if (!chatManager || typeof chatManager.initialize !== 'function') {
        notify.error('[App] createChatManager() did not return a valid ChatManager instance.', { group: true, context: 'app', module: 'App', source: 'init', phase: 'init', timestamp: performance.now() });
        throw new Error('[App] createChatManager() did not return a valid ChatManager instance.');
    }
    DependencySystem.register('chatManager', chatManager);

    let regChatManager = DependencySystem.modules.get('chatManager');
    if (regChatManager === createChatManager || typeof regChatManager.loadConversation !== 'function') {
        const notify = DependencySystem.modules.get('notify');
        notify?.error?.('[App] ERROR: chatManager registered incorrectly – fixing.', { group: true, context: "app", phase: 'init' });
        DependencySystem.modules.delete('chatManager');
        DependencySystem.register('chatManager', chatManager);
    }

    // Deprecated: Remove window.showNotification and all direct fallback notificationHandlerWithLog access.
    document.addEventListener('locationchange', function () {
        const container = notify.getContainer?.() || document.getElementById('notificationArea');
        if (container) {
            const notificationsToKeep = Array.from(container.children).filter(
                el => el.classList.contains('priority') || el.classList.contains('sticky')
            );
            notify.clear();
            notificationsToKeep.forEach(el => container.appendChild(el));
        }
    });
    // .show is handled by notification-handler's implementation with grouping/timer.

    if (APP_CONFIG.DEBUG) {
        notify.debug('[App] Initializing application...', { phase: 'init', timestamp: performance.now() });
    }
    appState.initializing = true;
    appState.currentPhase = 'starting';

    globalUtils.toggleElement(APP_CONFIG.SELECTORS.APP_LOADING_SPINNER, true);
    const initStartTime = performance.now();

    // ADD LOGGING HERE
    if (APP_CONFIG.DEBUG) notify.debug('[App Debug] Entering main async try block...', { context: 'app', module: 'App', source: 'init' });
    try {
        const _phaseStart = performance.now();
        appState.currentPhase = 'init_core_systems';
        notify.debug('[App] Phase: init_core_systems - STARTING', { group: true, context: 'app', module: 'App', source: 'init', phase: appState.currentPhase, timestamp: _phaseStart });
        await initializeCoreSystems();
        notify.debug(`[App] Phase "init_core_systems" completed in ${(performance.now() - _phaseStart).toFixed(2)} ms - FINISHED`, { group: true, context: 'app', module: 'App', source: 'init', phase: appState.currentPhase });

        appState.currentPhase = 'waiting_core_deps';
        notify.debug('[App] Phase: waiting_core_deps, waiting for DI deps', { group: true, context: 'app', module: 'App', source: 'init', phase: appState.currentPhase, timestamp: performance.now() });
        await waitFor(['auth', 'eventHandlers', 'notificationHandler', 'modalManager'], null, APP_CONFIG.TIMEOUTS.DEPENDENCY_WAIT);

        appState.currentPhase = 'init_auth';
        const _authInitStart = performance.now();
        notify.debug('[App] Phase: init_auth - STARTING', { group: true, context: 'app', module: 'App', source: 'init', phase: appState.currentPhase, timestamp: _authInitStart });
        await initializeAuthSystem();
        notify.debug(`[App] initializeAuthSystem complete in ${(performance.now() - _authInitStart).toFixed(2)} ms - FINISHED`, { group: true, context: 'app', module: 'App', source: 'init', phase: appState.currentPhase });

        if (appState.isAuthenticated) {
            notify.debug(`[App] User is authenticated; fetching current user`, { group: true, context: 'app', module: 'App', source: 'init', phase: appState.currentPhase, timestamp: performance.now() });
            const _currUserStart = performance.now();
            currentUser = await fetchCurrentUser();
            if (currentUser) {
                browserAPI.setCurrentUser(currentUser);
                DependencySystem.register('currentUser', currentUser);
                notify.info(`[App] Current user loaded`, { group: true, context: 'app', module: 'App', source: 'init', phase: appState.currentPhase, user: currentUser, ms: (performance.now() - _currUserStart) });
            } else {
                notify.warn(`[App] No current user found (was expected)`, { group: true, context: 'app', module: 'App', source: 'init', phase: appState.currentPhase, ms: (performance.now() - _currUserStart) });
            }
        }

        appState.currentPhase = 'init_ui';
        const _uiStart = performance.now();
        notify.debug('[App] Phase: init_ui', { group: true, context: 'app', module: 'App', source: 'init', phase: appState.currentPhase, timestamp: _uiStart });
        await initializeUIComponents();
        notify.debug(`[App] initializeUIComponents complete in ${(performance.now() - _uiStart).toFixed(2)} ms`, { group: true, context: 'app', module: 'App', source: 'init', phase: appState.currentPhase });

        appState.currentPhase = 'registering_listeners';
        const _listenersStart = performance.now();
        notify.debug('[App] Phase: registering_listeners', { group: true, context: 'app', module: 'App', source: 'init', phase: appState.currentPhase, timestamp: _listenersStart });
        registerAppListeners();
        notify.debug(`[App] registerAppListeners complete in ${(performance.now() - _listenersStart).toFixed(2)} ms`, { group: true, context: 'app', module: 'App', source: 'init', phase: appState.currentPhase });

        appState.currentPhase = 'finalizing';
        appState.initialized = true;

        try {
            notify.debug('[App] Phase: finalization sub-tasks', { group: true, context: 'app', module: 'App', source: 'init', phase: appState.currentPhase });
            const eh = DependencySystem.modules.get('eventHandlers');
            eh?.init?.();
            DependencySystem.modules.get('modelConfig')?.initializeUI?.();
        } catch (err) {
            notify.warn('[App] Post-initialization safety net failed:', { group: true, context: 'app', module: 'App', source: 'init', phase: appState.currentPhase, error: err, errorStack: err?.stack });
        }

        notify.debug('[App] handleNavigationChange() (final phase)', { group: true, context: 'app', module: 'App', source: 'init', phase: appState.currentPhase, timestamp: performance.now() });
        handleNavigationChange();

        const initEndTime = performance.now();
        const totalMs = initEndTime - initStartTime;
        if (APP_CONFIG.DEBUG) {
            notify?.info?.(
                `[App] Initialization complete in ${totalMs.toFixed(2)} ms. (phase=${appState.currentPhase})`,
                { group: true, context: 'app', module: 'App', source: 'init', phase: appState.currentPhase, ms: totalMs, timestamp: initEndTime, authenticated: appState.isAuthenticated, initialized: appState.initialized }
            );
            if (totalMs > 3000) {
                notify?.warn?.(`[App] Initialization exceeded perf warning threshold: ${totalMs.toFixed(1)} ms`, { group: true, context: 'app', module: 'App', source: 'init', phase: appState.currentPhase, ms: totalMs });
            }
        }
        document.dispatchEvent(new CustomEvent('appInitialized', { detail: { success: true } }));
        return true;

    } catch (err) {
        notify?.error?.('[App] Caught error in main init()', { group: true, context: 'app', module: 'App', source: 'init', error: err, phase: appState.currentPhase, timestamp: performance.now(), errorStack: err?.stack });
        handleInitError(err);
        document.dispatchEvent(new CustomEvent('appInitialized', { detail: { success: false, error: err } }));
        return false;
    } finally {
        const totalFinalMs = performance.now() - _initStart;
        if (APP_CONFIG.DEBUG) {
            notify.debug(`[App] init() finally block executed, hiding spinner. Total init=${totalFinalMs.toFixed(1)} ms`, { group: true, context: 'app', module: 'App', source: 'init', phase: appState.currentPhase, ms: totalFinalMs });
        }
        appState.initializing = false;
        globalUtils.toggleElement(APP_CONFIG.SELECTORS.APP_LOADING_SPINNER, false);
        appState.currentPhase = appState.initialized ? 'initialized' : 'failed';
    }
}

async function initializeCoreSystems() {
    if (APP_CONFIG.DEBUG) {
        notify.debug('[App] Initializing core systems...', { context: 'app', module: 'App', source: 'initializeCoreSystems' });
    }
    if (document.readyState !== 'complete' && document.readyState !== 'interactive') {
        await new Promise(resolve => {
            document.addEventListener('DOMContentLoaded', resolve, { once: true });
        });
    }
    notify.getContainer?.();

    const modalManager = createModalManager();
    DependencySystem.register('modalManager', modalManager);
    window.modalManager = modalManager;

    const [apiRequestMod, eventHandlersMod, , modalManagerMod] =
        await DependencySystem.waitFor(['apiRequest', 'eventHandlers', 'notificationHandler', 'modalManager']);

    await new Promise((resolve) => {
        if (document.getElementById('loginModal')) return resolve();
        document.addEventListener('modalsLoaded', () => resolve(), { once: true });
    });

    let auth;
    try {
        auth = createAuthModule({
            apiRequest: apiRequestMod,
            notify: notify,
            eventHandlers: eventHandlersMod,
            domAPI: { getElementById: (id) => document.getElementById(id), isDocumentHidden: () => document.hidden },
            sanitizer: DependencySystem.modules.get('sanitizer'),
            modalManager: modalManagerMod,
            apiEndpoints: DependencySystem.modules.get('apiEndpoints')
        });
        DependencySystem.register('auth', auth);
    } catch (err) {
        auth = {
            isAuthenticated: () => false,
            init: () => { throw new Error("[App] auth unavailable due to error during initialization: " + err.message); }
        };
        DependencySystem.register('auth', auth);
        if (notify && typeof notify.error === "function") {
            notify.error("[App] Critical error initializing auth module: " + err.message, { group: true, context: "app" });
        }
        globalUtils.toggleElement(APP_CONFIG.SELECTORS.APP_LOADING_SPINNER, false);
        if (typeof document !== "undefined") {
            document.body.innerHTML =
            `<div style="padding: 2em; color: red; font-family: sans-serif;">
             <strong>Application Error:</strong> ${err.message}<br>
             <span>Please contact support or refresh.</span>
            </div>`;
        }
        throw err;
    }

    const chatMgrInstance = DependencySystem.modules.get('chatManager');
    if (!chatMgrInstance || typeof chatMgrInstance.initialize !== 'function') {
        throw new Error('[App] chatManager registration: not a valid instance with "initialize".');
    }

    const projectManager = createProjectManager({
        DependencySystem,
        chatManager: chatMgrInstance,
        app,
        notify,
        apiEndpoints: DependencySystem.modules.get('apiEndpoints'),
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

    function validateModule(name, instance, requiredMethod) {
        if (typeof instance === 'function') {
            notify?.error?.(`[App] ${name} registration error: got a function instead of an instance`, { group: true, context: name });
            throw new Error(`[App] ${name} registration: not a valid instance (got function)`);
        }
        if (!instance || typeof instance[requiredMethod] !== 'function') {
            notify?.error?.(`[App] ${name} invalid: see developer console for details.`, { group: true, context: name });
            throw new Error(`[App] ${name} registration: not a valid instance with "${requiredMethod}" method`);
        }
    }

    validateModule('projectManager', projectManager, 'initialize');

    const projectModal = createProjectModal();
    DependencySystem.register('projectModal', projectModal);

    async function injectAndVerifyHtml(url, containerId, requiredElementIds, maxTries = 10) {
        const doc = browserAPI.getDocument();
        let container = doc.getElementById(containerId);
        if (!container) {
            notify.error(`[App] #${containerId} element not found in DOM`);
            container = doc.createElement('div');
            container.id = containerId;
            doc.body.appendChild(container);
            notify.debug(`[App] Created missing #${containerId}`, { context: 'app', module: 'App', source: 'injectAndVerifyHtml' });
        }

        notify.debug(`[App] Attempting to load and inject HTML from ${url}...`, { context: 'app', module: 'App', source: 'injectAndVerifyHtml' });

        try {
            const resp = await fetch(url, { cache: 'no-store' });
            notify.debug(`[App] Fetch status for ${url}: ${resp.status}`, { context: 'app', module: 'App', source: 'injectAndVerifyHtml' });
            if (!resp.ok) {
                throw new Error(`HTTP error! status: ${resp.status}`);
            }

            const html = await resp.text();
            notify.debug(`[App] HTML loaded from ${url}, length: ${html.length}`, { context: 'app', module: 'App', source: 'injectAndVerifyHtml' });

            if (html && html.length > 0) {
                container.innerHTML = html;
                notify.debug(`[App] HTML injected into #${containerId}`, { context: 'app', module: 'App', source: 'injectAndVerifyHtml' });
                doc.dispatchEvent(new CustomEvent('modalsLoaded'));
            } else {
                throw new Error('Empty HTML response');
            }
        } catch (err) {
            notify?.error?.(`[App] HTML fetch/injection failed for ${url}: ${err?.message || err}`, { group: true, context: "app" });
            doc.dispatchEvent(new CustomEvent('modalsLoaded'));
        }

        for (let attempt = 0; attempt < maxTries; attempt++) {
            let allFound = true;
            for (const id of requiredElementIds) {
                if (!doc.getElementById(id)) {
                    allFound = false;
                    break;
                }
            }
            if (allFound) return true;
            await new Promise(r => setTimeout(r, 150));
        }
        return false;
    }

    const modalsReady = new Promise((resolve) => {
        const timeout = setTimeout(() => {
            notify?.error?.('[App] TIMEOUT: Modal HTML failed to load in 15 seconds', { group: true, context: "app" });
            resolve();
        }, 15000);

        const modalsLoadedRemover = eventHandlers.trackListener(
            document,
            'modalsLoaded',
            () => {
                clearTimeout(timeout);
                resolve();
                if (typeof modalsLoadedRemover?.remove === 'function') {
                    modalsLoadedRemover.remove();
                }

                setTimeout(() => {
                    const projectForm = document.getElementById('projectModalForm');
                    if (!projectForm) return;
                    projectForm.onsubmit = null;
                    projectForm.addEventListener('submit', async (e) => {
                        e.preventDefault();
                        const submitBtn = projectForm.querySelector('button[type="submit"]');
                        if (submitBtn) {
                            submitBtn.disabled = true;
                            submitBtn.innerHTML = `<span class="loading loading-spinner loading-xs"></span> Saving...`;
                        }
                        const formData = new FormData(projectForm);
                        const data = {};
                        for (let [key, value] of formData.entries()) {
                            if (key === 'projectId' && !value) continue;
                            if (key === 'maxTokens' || key === 'max_tokens') {
                                data.max_tokens = parseInt(value, 10);
                            } else {
                                data[key] = value;
                            }
                        }
                        if (!data.name) {
                            notify?.error?.('Project name is required', { group: true, context: 'projectModal' });
                            if (submitBtn) {
                                submitBtn.disabled = false;
                                submitBtn.textContent = 'Save Project';
                            }
                            return;
                        }
                        try {
                            const pm = window.projectManager || (window.DependencySystem?.modules?.get?.('projectManager'));
                            if (pm?.createProject) {
                                await pm.createProject(data);
                            } else if (pm?.saveProject) {
                                await pm.saveProject(undefined, data);
                            } else {
                                throw new Error('ProjectManager unavailable in DI');
                            }
                            notify?.success?.('Project created', { group: true, context: 'projectModal' });
                            const mm = window.modalManager || (window.DependencySystem?.modules?.get?.('modalManager'));
                            if (mm?.hide) {
                                mm.hide('project');
                            }
                            if (pm?.loadProjects) {
                                pm.loadProjects('all');
                            }
                        } catch (err) {
                            notify?.error?.('Failed to create project: ' + (err?.message || err), { group: true, context: 'projectModal' });
                        } finally {
                            if (submitBtn) {
                                submitBtn.disabled = false;
                                submitBtn.textContent = 'Save Project';
                            }
                        }
                    });
                }, 0);
            }
        );

        (async () => {
            await injectAndVerifyHtml('/static/html/modals.html', 'modalsContainer', Object.values(MODAL_MAPPINGS));
        })();
    });

    const modalsTimeout = setTimeout(() => {
        notify?.error?.('[App] TIMEOUT: Modal HTML failed to load in 10 seconds', { group: true, context: "app", module: "App", source: "initializeCoreSystems" });
        browserAPI.getDocument().dispatchEvent(new CustomEvent('modalsLoaded'));
    }, 10000);

    const modalsLoadedRemover2 = eventHandlers.trackListener(
        document,
        'modalsLoaded',
        () => {
            clearTimeout(modalsTimeout);
            if (typeof modalsLoadedRemover2?.remove === 'function') {
                modalsLoadedRemover2.remove();
            }
        },
        { description: '[App] Modal HTML short-timeout handler' }
    );

    await modalsReady;
    notify.debug('[App] Modal HTML load promise resolved. Proceeding with initialization.', { context: 'app', module: 'App', source: 'initializeCoreSystems' });

    notify.debug('[App] Injecting and verifying modals HTML...', { context: 'app', module: 'App', source: 'initializeCoreSystems' });
    const modalsOk = await injectAndVerifyHtml('/static/html/modals.html', 'modalsContainer', Object.values(MODAL_MAPPINGS));
    notify.debug(`[App] Modal HTML injection result: ${modalsOk}`, { context: 'app', module: 'App', source: 'initializeCoreSystems' });
    if (!modalsOk) {
        notify?.error?.('[App] One or more modal dialogs failed to appear after HTML injection.', { group: true, context: "app", module: "App", source: "initializeCoreSystems" });
        if (APP_CONFIG.DEBUG) {
            notify.error('[App] One or more modal dialogs failed to appear in DOM after modal HTML injection.', { group: true, context: 'app', module: 'App', source: 'initializeCoreSystems' });
        }
    }

    if (typeof modalManager.init === 'function') {
        modalManager.init();
    } else {
        notify?.error?.('[App] modalManager.init function not found!', { group: true, context: "app" });
    }

    if (typeof chatMgrInstance.initialize === 'function' && appState.isAuthenticated) {
        if (APP_CONFIG.DEBUG) {
            notify.debug('[App] Initializing ChatManager (user already authenticated)…', { context: 'app', module: 'App', source: 'initializeCoreSystems' });
        }
        await chatMgrInstance.initialize();
    }

    if (typeof projectModal.init === 'function') {
        projectModal.init();
    } else {
        notify?.error?.('[App] Project modal init function not found!', { group: true, context: "app", module: "App", source: "initializeCoreSystems" });
        if (APP_CONFIG.DEBUG) {
            notify.error('[App] projectModal.init function not found!', { group: true, context: 'app', module: 'App', source: 'initializeCoreSystems' });
        }
    }

    if (typeof projectManager.initialize === 'function') {
        await projectManager.initialize();
    }
    if (typeof eventHandlersMod?.init === 'function') {
        eventHandlersMod.init();
    }
    if (APP_CONFIG.DEBUG) {
        notify.debug('[App] Core systems initialized.', { context: 'app', module: 'App', source: 'initializeCoreSystems' });
    }
}

async function initializeAuthSystem() {
    if (APP_CONFIG.DEBUG) {
        notify.debug('[App] Initializing authentication system...', { context: 'app', module: 'App', source: 'initializeAuthSystem' });
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
            notify.debug(`[App] Initial authentication state: ${appState.isAuthenticated}`, { context: 'app', module: 'App', source: 'initializeAuthSystem' });
        }
        const bus = auth.AuthBus;
        if (bus && typeof eventHandlers.trackListener === 'function') {
            eventHandlers.trackListener(
                bus,
                'authStateChanged',
                () => {
                    appState.isAuthenticated = auth.isAuthenticated();
                    renderAuthHeader();
                },
                { description: '[App] AuthBus authStateChanged (DI event handler)' }
            );
        }
        renderAuthHeader();
    } catch (err) {
        notify.error('[App] Auth system initialization/check failed:', { group: true, context: 'app', module: 'App', source: 'initializeAuthSystem', error: err });
        appState.isAuthenticated = false;
        notify?.error?.(`Authentication check failed: ${err.message}`, { group: true, context: "auth", module: "Auth", source: "init" });
        throw new Error(`[App] initializeAuthSystem failed: ${err.message}`);
    }
}

let _uiComponentsInitialized = false;
async function initializeUIComponents() {
    const notify = DependencySystem.modules.get('notify'); // Reverted to notify for this scope, or ensure it's consistently named
    const browserAPI = DependencySystem.modules.get('browserAPI');
    const doc = browserAPI.getDocument();

    if (_uiComponentsInitialized) {
        if (APP_CONFIG.DEBUG) {
            notify.warn('[App] initializeUIComponents called twice, skipping.', { context: 'app', module: 'App', source: 'initializeUIComponents' });
        }
        return;
    }
    _uiComponentsInitialized = true;
    if (APP_CONFIG.DEBUG) {
        notify.debug('[App] Initializing UI components...', { context: 'app', module: 'App', source: 'initializeUIComponents' });
    }

    await globalUtils.waitForDepsAndDom({
        deps: ['projectManager', 'eventHandlers', 'modalManager'],
        domSelectors: ['body'],
        DependencySystem
    });

    let projectListView = doc.getElementById('projectListView');
    let projectDetailsView = doc.getElementById('projectDetailsView');
    if (!projectListView) {
        projectListView = doc.createElement('div');
        projectListView.id = 'projectListView';
        projectListView.className = 'w-full';
        doc.body.appendChild(projectListView);
    }
    if (!projectDetailsView) {
        projectDetailsView = doc.createElement('div');
        projectDetailsView.id = 'projectDetailsView';
        projectDetailsView.className = 'w-full hidden';
        doc.body.appendChild(projectDetailsView);
    }

    // ADD LOGGING HERE
    notify.debug('[App] Injecting and verifying project list HTML...', { context: 'app', module: 'App', source: 'initializeUIComponents' });
    if (!doc.getElementById('projectList')) {
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
            if (!doc.getElementById('projectList')) {
                notify?.error?.('Static /static/html/project_list.html inject failed (missing #projectList)!', { group: true, context: "app", module: "App", source: "initializeUIComponents", timeout: 10000 });
                throw new Error('Injected /static/html/project_list.html but #projectList is still missing!');
            }
            // ADD LOGGING HERE
            notify.debug('[App] Project list HTML injection complete.', { context: 'app', module: 'App', source: 'initializeUIComponents' });
        } catch (err) {
            notify?.error?.(`Failed to load project list UI: ${err.message}`, { group: true, context: "app", module: "App", source: "initializeUIComponents", timeout: 10000 });
            throw err;
        }
    }

    // ADD LOGGING HERE
    notify.debug('[App] Injecting and verifying project details HTML...', { context: 'app', module: 'App', source: 'initializeUIComponents' });
    if (!doc.getElementById('projectDetails')) {
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
            if (!doc.getElementById('projectDetails')) {
                notify?.error?.('Static /static/html/project_details.html inject failed (missing #projectDetails)!', { group: true, context: "app", module: "App", source: "initializeUIComponents", timeout: 10000 });
                throw new Error('Injected /static/html/project_details.html but #projectDetails is still missing!');
            }
            // ADD LOGGING HERE
            notify.debug('[App] Project details HTML injection complete.', { context: 'app', module: 'App', source: 'initializeUIComponents' });
        } catch (err) {
            notify?.error?.(`Failed to load project details UI: ${err.message}`, { group: true, context: "app", module: "App", source: "initializeUIComponents", timeout: 10000 });
            throw err;
        }
    }

    const projectManager = DependencySystem.modules.get('projectManager');
    const modalManager = DependencySystem.modules.get('modalManager');

    setTimeout(() => {
        window.setupLoginButtonHandler?.(eventHandlers, modalManager);
    }, 0);

    if (FileUploadComponent) {
        DependencySystem.register('FileUploadComponent', FileUploadComponent);
    }

    const chatExtensions = createChatExtensions({
        DependencySystem,
        eventHandlers,
        notificationHandler: DependencySystem.modules.get('notificationHandler')
    });
    DependencySystem.register('chatExtensions', chatExtensions);

    const modelConfig = createModelConfig();
    DependencySystem.register('modelConfig', modelConfig);

    const projectDashboardUtils = createProjectDashboardUtils({ DependencySystem });
    DependencySystem.register('projectDashboardUtils', projectDashboardUtils);

    const notifyForUi = DependencySystem.modules.get('notify');
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
        notify: notifyForUi,
        storage: DependencySystem.modules.get('storage'),
        sanitizer: DependencySystem.modules.get('sanitizer')
    });
    DependencySystem.register('projectListComponent', projectListComponent);

    if (DependencySystem.modules.get('projectDashboard') === createProjectDashboard) {
        DependencySystem.modules.delete('projectDashboard');
    }
    const projectDashboard = createProjectDashboard(DependencySystem);
    DependencySystem.register('projectDashboard', projectDashboard);

    const projectDetailsComponent = createProjectDetailsComponent({
        onBack: async () => {
            try {
                const pd = await DependencySystem.waitFor('projectDashboard');
                pd?.showProjectList?.();
            } catch {
                // Error retrieving project ID
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
        domAPI: {
            getDocument: () => document,
            getElementById: (id) => document.getElementById(id),
            createElement: (tag) => document.createElement(tag),
            querySelector: (selector) => document.querySelector(selector),
            dispatchEvent: (event) => document.dispatchEvent(event)
        },
        notify: notifyForUi,
        sanitizer: DependencySystem.modules.get('sanitizer')
    });
    DependencySystem.register('projectDetailsComponent', projectDetailsComponent);

    const sidebar = createSidebar({
        DependencySystem,
        eventHandlers,
        app,
        projectDashboard,
        projectManager,
        notify: notifyForUi,
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

    DependencySystem.register('utils', globalUtils);

    const knowledgeBaseComponent = createKnowledgeBaseComponent({
        DependencySystem,
        apiRequest,
        auth: DependencySystem.modules.get('auth'),
        projectManager,
        showNotification: DependencySystem.modules.get('notificationHandler').show,
        uiUtils: globalUtils,
        sanitizer: DependencySystem.modules.get('sanitizer')
    });
    DependencySystem.register('knowledgeBaseComponent', knowledgeBaseComponent);

    if (typeof sidebar.init === 'function') {
        try {
            await sidebar.init();
        } catch (err) {
            notify?.error?.('[App] Failed to initialize sidebar: ' + (err?.message || err), { group: true, context: "sidebar", module: "Sidebar", source: "init" });
        }
    }
    chatExtensions.init();
    if (modelConfig?.initializeUI) {
        modelConfig.initializeUI();
    }
    if (typeof knowledgeBaseComponent.initialize === 'function') {
        try {
            await knowledgeBaseComponent.initialize();
        } catch (err) {
            notify?.error?.('[App] Failed to initialize knowledge base component: ' + (err?.message || err), { group: true, context: "knowledgeBaseComponent", module: "KnowledgeBaseComponent", source: "initialize" });
        }
    }
    if (typeof projectDashboard.initialize === 'function') {
        try {
            if (APP_CONFIG.DEBUG) {
                notify.debug('[App] Initializing ProjectDashboard instance...', { context: 'app', module: 'App', source: 'initializeUIComponents' });
            }
            await projectDashboard.initialize();
        } catch (err) {
            notify?.error?.('[App] Failed to initialize project dashboard: ' + (err?.message || err), { group: true, context: "projectDashboard", module: "ProjectDashboard", source: "initialize" });
        }
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
            notify.debug('[App] Calling projectManager.loadProjects from initializeUIComponents', { context: 'app', module: 'App', source: 'initializeUIComponents' });
            projectManager.loadProjects('all').catch(err => {
                notify.error('[App] Failed to load projects during initialization:', { group: true, context: 'app', module: 'App', source: 'initializeUIComponents', error: err });
                notify?.error?.('Failed to load projects. Please try refreshing.', { group: true, context: "projectManager", module: "ProjectManager", source: "loadProjects" });
            });
        } else {
            notify.error('[App] projectManager or loadProjects method not available:', { group: true, context: 'app', module: 'App', source: 'initializeUIComponents', projectManagerInstance: projectManager });
            notify?.error?.('Project manager initialization issue. Please try refreshing.', { group: true, context: "projectManager", module: "ProjectManager", source: "initialize" });
        }
    } else {
        notify.warn('[App] Not authenticated, skipping initial project load', { context: 'app', module: 'App', source: 'initializeUIComponents' });
    }

    if (typeof window.initAccessibilityEnhancements === 'function') {
        window.initAccessibilityEnhancements();
    }
    if (typeof window.initSidebarEnhancements === 'function') {
        window.initSidebarEnhancements();
    }

    if (APP_CONFIG.DEBUG) {
        notify.debug('[App] UI components initialized.', { context: 'app', module: 'App', source: 'initializeUIComponents' });
    }
}

function renderAuthHeader() {
    try {
        const browserAPI = DependencySystem.modules.get('browserAPI');
        const doc = browserAPI.getDocument();
        const authMod = DependencySystem.modules.get('auth');
        const isAuth = typeof authMod?.isAuthenticated === 'function' && authMod.isAuthenticated();

        const btn = doc.querySelector(APP_CONFIG.SELECTORS.AUTH_BUTTON) || doc.querySelector('#loginButton');
        if (btn) {
            btn.textContent = isAuth ? 'Logout' : 'Login';
            btn.onclick = null;
            const eventHandlers = DependencySystem.modules.get('eventHandlers');
            if (eventHandlers?.trackListener) {
                eventHandlers.trackListener(
                    btn,
                    'click',
                    function (e) {
                        e.preventDefault();
                        if (isAuth) {
                            authMod.logout();
                        } else {
                            const modal = DependencySystem.modules.get('modalManager');
                            if (modal?.show) modal.show('login');
                        }
                    },
                    { description: '[App] Auth login/logout button' }
                );
            }
        }
        const authStatus = doc.querySelector(APP_CONFIG.SELECTORS.AUTH_STATUS_SPAN);
        const userStatus = doc.querySelector(APP_CONFIG.SELECTORS.USER_STATUS_SPAN);
        if (authStatus) authStatus.textContent = isAuth ? 'Signed in' : 'Not signed in';
        if (userStatus) userStatus.textContent = isAuth ? `Hello, ${authMod.getCurrentUser()}` : '';
    } catch {
        // renderAuthHeader error
    }
}


function registerAppListeners() {
    const notify = DependencySystem.modules.get('notify');
    if (APP_CONFIG.DEBUG && notify) {
        notify.debug('[App] Registering global event listeners...', { context: 'app', module: 'App', source: 'registerAppListeners' });
    }

    waitFor(['auth', 'chatManager', 'projectManager'], () => {
        attachAuthBusListener('authStateChanged', handleAuthStateChange, '_globalAuthStateChangedAttached');
        setupChatInitializationTrigger();
        eventHandlers.trackListener(window, 'locationchange', handleNavigationChange, {
            description: 'Global locationchange event'
        });
    }).catch(err => {
        if (notify) notify.error('[App] Failed to wait for dependencies:', { group: true, context: 'app', module: 'App', source: 'registerAppListeners', error: err });
    });

    if (APP_CONFIG.DEBUG && notify) {
        notify.debug('[App] Global event listeners registered.', { context: 'app', module: 'App', source: 'registerAppListeners' });
    }
}


function setupChatInitializationTrigger() {
    const requiredDeps = ['auth', 'chatManager', 'projectManager'];
    const debouncedInitChat = globalUtils.debounce((arg = null) => {
        const asyncProcess = (async () => {
            let finalProjectId = null; // Declare here for broader scope
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
                        DependencySystem.modules.get('notify')?.warn?.('[App] Chat init: Required dependency missing.', { group: true, context: 'app', module: 'App', source: 'debouncedInitChat', deps: [authMod, chatMgr, pm] });
                    }
                    return;
                }
                if (typeof authMod.isAuthenticated !== "function") {
                    if (APP_CONFIG.DEBUG) {
                        DependencySystem.modules.get('notify')?.warn?.('[App] Chat init: auth.isAuthenticated is not a function.', { group: true, context: 'app', module: 'App', source: 'debouncedInitChat', authModule: authMod });
                    }
                    return;
                }

                const projectId = app.getProjectId();
                finalProjectId = forceProjectId ?? projectId ?? pm?.currentProject?.id ?? null; // Assign here

                // Ensure user is authenticated AND we have a valid project ID before initializing chat
                if (authMod.isAuthenticated() && typeof chatMgr.initialize === "function") {
                    if (APP_CONFIG.DEBUG) {
                        DependencySystem.modules.get('notify')?.debug?.(`[App] Debounced chat init triggered. Auth: true, Project ID check: ${finalProjectId}`, { group: true, context: 'app', module: 'App', source: 'debouncedInitChat' });
                    }
                    // Only initialize if we have a valid project ID determined by the logic above
                    if (finalProjectId && globalUtils.isValidProjectId(finalProjectId)) {
                         if (APP_CONFIG.DEBUG) {
                             DependencySystem.modules.get('notify')?.debug?.(`[App] Initializing chat with Project ID: ${finalProjectId}`, { group: true, context: 'app', module: 'App', source: 'debouncedInitChat' });
                         }
                        await chatMgr.initialize({ projectId: finalProjectId });
                    } else {
                        // If authenticated but no project ID yet (likely due to timing), clear the chat state.
                        if (APP_CONFIG.DEBUG) {
                            DependencySystem.modules.get('notify')?.debug?.(`[App] Skipping chat initialize: No valid project ID found (Project: ${finalProjectId}). Clearing chat.`, { group: true, context: 'app', module: 'App', source: 'debouncedInitChat' });
                        }
                        chatMgr?.clear?.(); // Call clear instead if no valid project
                    }
                } else { // Not authenticated or chatMgr invalid
                    if (APP_CONFIG.DEBUG) {
                        DependencySystem.modules.get('notify')?.debug?.(
                            `[App] Skipping debounced chat init. Auth: ${authMod.isAuthenticated?.() ?? 'N/A'}, ` +
                            `chatMgr valid: ${typeof chatMgr.initialize === "function"}, Project: ${finalProjectId}`,
                            { group: true, context: 'app', module: 'App', source: 'debouncedInitChat' }
                        );
                    }
                    chatMgr?.clear?.();
                }
            } catch (err) {
                const notify = DependencySystem.modules.get('notify');
                // Make error message more informative by including the original error message
                const errorMessage = `[App] Error during debounced chat initialization: ${err?.message || err}`;
                notify?.error?.(errorMessage, {
                    group: true,
                    context: 'app',
                    module: 'App',
                    source: 'debouncedInitChat',
                    projectIdAttempted: finalProjectId, // Add context about the ID attempted
                    originalError: err // Keep original error object for full details
                });
            }
        })();

        asyncProcess.catch(err => {
            const notify = DependencySystem.modules.get('notify');
            notify?.error?.('[App] Unhandled error in chat initialization asyncProcess', {
                group: true,
                context: 'app',
                module: 'App',
                source: 'debouncedInitChat.asyncProcess',
                originalError: err
            });
        });

        return false;
    }, 350);

    waitFor(requiredDeps, () => {
        attachAuthBusListener('authStateChanged', debouncedInitChat, '_globalChatInitAuthAttached');
        if (!document._chatInitProjListenerAttached) {
            eventHandlers.trackListener(
                document,
                'currentProjectChanged',
                () => {
                    debouncedInitChat();
                    return false;
                },
                { description: 'Current project changed -> reinit chat' }
            );
            document._chatInitProjListenerAttached = true;
            if (APP_CONFIG.DEBUG) {
                DependencySystem.modules.get('notify')?.warn?.('[App] Using eventHandlers for currentProjectChanged -> chat reinit listener.', { group: true, context: 'app', module: 'App', source: 'setupChatInitializationTrigger' });
            }
        }
        eventHandlers.trackListener(
            document,
            'currentProjectReady',
            e => {
                debouncedInitChat(e.detail?.project?.id);
                return false;
            },
            { description: 'Project ready -> reinit chat' }
        );
        debouncedInitChat();
    }, APP_CONFIG.TIMEOUTS.DEPENDENCY_WAIT * 2)
        .catch(err => {
            DependencySystem.modules.get('notify')?.error?.('[App] Failed setup for chat init triggers:', { group: true, context: 'app', module: 'App', source: 'setupChatInitializationTrigger', error: err });
        });
}

let lastHandledProj = null;
let lastHandledChat = null;

async function handleNavigationChange() {
    const notify = DependencySystem.modules.get('notify');
    if (!appState.initialized) {
        if (appState.initializing) {
            await new Promise(r => setTimeout(r, 150));
            if (!appState.initialized) {
                if (APP_CONFIG.DEBUG && notify) {
                    notify.warn("[App] handleNavigationChange: Aborted, initialization didn't complete.", { context: 'app', module: 'App', source: 'handleNavigationChange' });
                }
                return;
            }
        } else {
            if (APP_CONFIG.DEBUG && notify) {
                notify.warn("[App] handleNavigationChange: Aborted, application not initialized.", { context: 'app', module: 'App', source: 'handleNavigationChange' });
            }
            return;
        }
    }

    const currentUrl = window.location.href;
    if (APP_CONFIG.DEBUG && notify) {
        notify.debug(`[App] Handling navigation change. URL: ${currentUrl}`, { context: 'app', module: 'App', source: 'handleNavigationChange' });
    }
    let projectDashboard;
    try {
        [projectDashboard] = await waitFor(['projectDashboard'], null, APP_CONFIG.TIMEOUTS.DEPENDENCY_WAIT);
    } catch (e) {
        if (notify) notify.error('[App] Project Dashboard unavailable for navigation:', { group: true, context: 'app', module: 'App', source: 'handleNavigationChange', error: e });
        notify?.error?.('UI Navigation Error.', { group: true, context: "app", module: "App", source: "handleNavigationChange" });
        globalUtils.toggleElement(APP_CONFIG.SELECTORS.APP_FATAL_ERROR, true);
        const errorEl = document.querySelector(APP_CONFIG.SELECTORS.APP_FATAL_ERROR);
        if (errorEl) errorEl.textContent = 'Core UI component failed to load. Please refresh.';
        return;
    }

    const url = new URL(currentUrl);
    const projectId = url.searchParams.get('project');
    const chatId = url.searchParams.get('chatId') || null;

    if (projectId === lastHandledProj && chatId === lastHandledChat) {
        if (APP_CONFIG.DEBUG && notify) {
            notify.debug('[App] handleNavigationChange: Same project/chat; skipping re-load.', { context: 'app', module: 'App', source: 'handleNavigationChange' });
        }
        return;
    }
    lastHandledProj = projectId;
    lastHandledChat = chatId;

    if (!appState.isAuthenticated) {
        if (APP_CONFIG.DEBUG && notify) {
            notify.debug('[App] Navigation change: User not authenticated.', { context: 'app', module: 'App', source: 'handleNavigationChange' });
        }
        projectDashboard.showLoginRequiredMessage?.();
        return;
    }
    globalUtils.toggleElement(APP_CONFIG.SELECTORS.LOGIN_REQUIRED_MESSAGE, false);

    try {
        const [projectManager] = await waitFor(['projectManager'], null, APP_CONFIG.TIMEOUTS.DEPENDENCY_WAIT);
        if (projectId && globalUtils.isValidProjectId(projectId)) {
            if (APP_CONFIG.DEBUG && notify) {
                notify.debug(`[App] Ensuring project ${projectId} details are loaded before UI...`, { context: 'app', module: 'App', source: 'handleNavigationChange' });
            }
            await projectManager.loadProjectDetails(projectId);
            if (typeof projectDashboard.showProjectDetails === 'function') {
                if (APP_CONFIG.DEBUG && notify) {
                    notify.debug(`[App] Navigating to project details: ${projectId}, chatId=${chatId ?? 'none'}`, { context: 'app', module: 'App', source: 'handleNavigationChange' });
                }
                await projectDashboard.showProjectDetails(projectId);
            }
        } else if (typeof projectDashboard.showProjectList === 'function') {
            if (APP_CONFIG.DEBUG && notify) {
                notify.debug('[App] Navigating to project list view.', { context: 'app', module: 'App', source: 'handleNavigationChange' });
            }
            await projectDashboard.showProjectList();
        } else {
            if (notify) notify.warn('[App] Unhandled navigation or missing dashboard methods.', { group: true, context: 'app', module: 'App', source: 'handleNavigationChange' });
            globalUtils.toggleElement(APP_CONFIG.SELECTORS.PROJECT_DETAILS_VIEW, false);
            globalUtils.toggleElement(APP_CONFIG.SELECTORS.PROJECT_LIST_VIEW, true);
        }

        if (projectId && globalUtils.isValidProjectId(projectId) && chatId) {
            try {
                const success = await app.navigateToConversation(chatId);
                if (!success && notify) {
                    notify.warn("[App] Chat load failed for chatId:", { group: true, context: 'app', module: 'App', source: 'handleNavigationChange', chatId });
                }
            } catch (e) {
                if (notify) notify.warn("[App] Error loading chatId after project ready:", { group: true, context: 'app', module: 'App', source: 'handleNavigationChange', error: e });
            }
        }
    } catch (navError) {
        if (notify) notify.error('[App] Error during navigation handling:', { group: true, context: 'app', module: 'App', source: 'handleNavigationChange', error: navError });
        notify?.error?.(`Navigation failed: ${navError.message}`, { group: true, context: "app", module: "App", source: "handleNavigationChange" });
        projectDashboard.showProjectList?.().catch(fb => {
            if (notify) notify.error('[App] Fallback failed:', { group: true, context: 'app', module: 'App', source: 'handleNavigationChange', error: fb });
        });
    }
}

let _authStateChangedAttached = false;
let _chatInitAuthAttached = false;

function attachAuthBusListener(event, handler, markerGlobalName) {
    const notify = DependencySystem.modules.get('notify');
    const bus = getAuthBus();
    if (!bus || typeof eventHandlers.trackListener !== "function") {
        notify?.error?.('[App] Cannot attach listener: AuthBus missing or invalid.', { group: true, context: 'app', module: 'App', source: 'attachAuthBusListener', authBus: bus });
        return false;
    }
    // Use internal flags instead of window globals
    if (markerGlobalName === '_globalAuthStateChangedAttached') {
        if (_authStateChangedAttached) return false;
        eventHandlers.trackListener(
            bus,
            event,
            handler,
            { description: `[App] AuthBus ${event} listener (via attachAuthBusListener)` }
        );
        _authStateChangedAttached = true;
        if (APP_CONFIG.DEBUG) {
            notify?.debug?.(`[App] Attached ${event} listener to AuthBus (internal marker _authStateChangedAttached).`, { context: 'app', module: 'App', source: 'attachAuthBusListener' });
        }
        return true;
    } else if (markerGlobalName === '_globalChatInitAuthAttached') {
        if (_chatInitAuthAttached) return false;
        eventHandlers.trackListener(
            bus,
            event,
            handler,
            { description: `[App] AuthBus ${event} listener (via attachAuthBusListener)` }
        );
        _chatInitAuthAttached = true;
        if (APP_CONFIG.DEBUG) {
            notify?.debug?.(`[App] Attached ${event} listener to AuthBus (internal marker _chatInitAuthAttached).`, { context: 'app', module: 'App', source: 'attachAuthBusListener' });
        }
        return true;
    } else {
        // fallback for any other marker name (should not occur)
        eventHandlers.trackListener(
            bus,
            event,
            handler,
            { description: `[App] AuthBus ${event} listener (via attachAuthBusListener)` }
        );
        if (APP_CONFIG.DEBUG) {
            notify?.debug?.(`[App] Attached ${event} listener to AuthBus (no marker).`, { context: 'app', module: 'App', source: 'attachAuthBusListener' });
        }
        return true;
    }
}

function getAuthBus() {
    const auth = DependencySystem?.modules?.get('auth');
    return auth?.AuthBus;
}

function handleAuthStateChange(event) {
    const notify = DependencySystem.modules.get('notify');
    const { authenticated, username } = event?.detail || {};
    const newAuthState = !!authenticated;
    if (newAuthState === appState.isAuthenticated) return false;

    const previousAuthState = appState.isAuthenticated;
    appState.isAuthenticated = newAuthState;
    if (APP_CONFIG.DEBUG && notify) {
        notify.debug(`[App] Auth state changed. Authenticated: ${appState.isAuthenticated}, User: ${username || 'N/A'}`, { context: 'app', module: 'App', source: 'handleAuthStateChange' });
    }

    requestAnimationFrame(() => {
        globalUtils.toggleElement(APP_CONFIG.SELECTORS.AUTH_BUTTON, !appState.isAuthenticated);
        globalUtils.toggleElement(APP_CONFIG.SELECTORS.USER_MENU, appState.isAuthenticated);
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

    (async function updateAuthStateUI() {
        let projectManager, projectDashboard, sidebar, chatManager, storage;
        try {
            [projectManager, projectDashboard, sidebar, chatManager, storage] = await Promise.all([
                waitFor('projectManager'),
                waitFor('projectDashboard'),
                waitFor('sidebar'),
                waitFor('chatManager'),
                waitFor('storage')
            ]);
        } catch (e) {
            notify?.error?.('[App] Failed to get modules during auth state change:', { group: true, context: 'app', module: 'App', source: 'updateAuthStateUI', error: e });
            notify?.error?.('Failed to update UI after auth change.', { group: true, context: "app", module: "App", source: "updateAuthStateUI" });
            return;
        }

        if (appState.isAuthenticated && !previousAuthState) {
            if (APP_CONFIG.DEBUG && notify) {
                notify.debug('[App] User logged in. Refreshing data/UI.', { context: 'app', module: 'App', source: 'updateAuthStateUI' });
            }
            globalUtils.toggleElement(APP_CONFIG.SELECTORS.LOGIN_REQUIRED_MESSAGE, false);

            try {
                projectDashboard.showProjectList?.();
                if (projectManager.loadProjects) {
                    try {
                        const projects = await projectManager.loadProjects('all');
                        if (APP_CONFIG.DEBUG && notify) {
                            notify.debug(`[App] Projects loaded after login: ${projects.length}`, { context: 'app', module: 'App', source: 'updateAuthStateUI' });
                        }
                        sidebar.renderProjects?.(projects);
                    } catch (err) {
                        notify?.error?.('[App] Failed to load projects after login:', { group: true, context: 'app', module: 'App', source: 'updateAuthStateUI', error: err });
                        notify?.error?.('Failed to load projects.', { group: true, context: "projectManager", module: "ProjectManager", source: "loadProjects" });
                    }
                }
            } catch (err) {
                if (notify) notify.error('[App] Error refreshing UI after login:', { group: true, context: 'app', module: 'App', source: 'updateAuthStateUI', error: err });
            }
        } else if (!appState.isAuthenticated && previousAuthState) {
            if (APP_CONFIG.DEBUG && notify) {
                notify.debug('[App] User logged out. Clearing data/UI.', { context: 'app', module: 'App', source: 'updateAuthStateUI' });
            }
            try {
                globalUtils.toggleElement(APP_CONFIG.SELECTORS.LOGIN_REQUIRED_MESSAGE, true);
                projectManager.currentProject = null;
                storage.removeItem('selectedProjectId');
                projectDashboard.showLoginRequiredMessage?.();
                sidebar.clear?.();
                chatManager.clear?.();
                try {
                    handleNavigationChange();
                } catch (navError) {
                    if (notify) notify.error('[App] Navigation error after logout:', { group: true, context: 'app', module: 'App', source: 'updateAuthStateUI', error: navError });
                }
            } catch (err) {
                if (notify) notify.error('[App] Error updating UI after logout:', { group: true, context: 'app', module: 'App', source: 'updateAuthStateUI', error: err });
            }
        }
    })().catch(err => {
        if (notify) notify.error('[App] Unhandled error in auth state change handler:', { group: true, context: 'app', module: 'App', source: 'updateAuthStateUI', error: err });
    });

    return false;
}


function handleInitError(error) {
    try {
        const errorReporter = DependencySystem?.modules?.get('errorReporter');
        errorReporter?.capture?.(error, {
            module: 'app',
            method: 'handleInitError',
            phase: appState.currentPhase
        });
    } catch (err) {
        if (APP_CONFIG.DEBUG) {
            notify.error('[App] Error in errorReporter.capture:', err);
        }
    }
    appState.initialized = false;
    appState.initializing = false;
    appState.currentPhase = 'failed';

    try {
        const notify = DependencySystem.modules.get('notify');
        notify?.error?.(`Application failed to start: ${error.message}. Please refresh.`, { group: true, context: "app", timeout: 15000 });
    } catch {
        // ignored
    }

    try {
        const container = document.querySelector(APP_CONFIG.SELECTORS.APP_FATAL_ERROR);
        if (container) {
            container.textContent = `Application Error: ${error.message}. Please refresh.`;
            container.classList.remove('hidden');
        } else {
            notify?.error?.(`Application Critical Error: ${error.message}. Please refresh.`, { group: true, context: "app", timeout: 30000 });
        }
    } catch {
        // ignored
    }
    globalUtils.toggleElement(APP_CONFIG.SELECTORS.APP_LOADING_SPINNER, false);
}
