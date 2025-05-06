/**
 * Updated application script
 * - Replaced separate browserAPI, apiClient, and storageService imports
 *   with a single import from globalUtils.js
 * - Corrected DI initialization order for eventHandlers, notificationHandler, and notify.
 * - Removed defensive checks for factory vs. instance registration, assuming correct registration.
 * - Consolidated eventHandlers.init() calls.
 */

/**
 * Sentry browser integration (Advanced DI pattern)
 * Uses createSentryManager from sentry-init.js for strict DI, dynamic config, and robust teardown.
 * Make sure to inject correct DSN via config/env!
 */
import { APP_CONFIG } from './appConfig.js';
import { createSentryManager } from './sentry-init.js';
/* -----------------------------------------------------------------------
 * HTML sanitizer (DOMPurify) – must be registered early for Auth & others
 * --------------------------------------------------------------------- */
import DOMPurify from './vendor/dompurify.es.js';

/* === STRICT MODULE INIT ORDER: Early Abstractions → DependencySystem → Core Services (Sentry, Notify, EventHandlers) → App Modules === */

// ────────────── Core config, utilities, no dependencies yet ──────────────
const sentryConfig = {
    dsn: 'https://b03711f63d1160f48dcaeda3edae14ac@o4508070823395328.ingest.us.sentry.io/4509138383863808', // TODO: Inject real DSN by build/runtime config
    environment: 'production', // TODO: Inject from build/env
    release: 'frontend-app@1.0.0', // TODO: Inject from build/env
    sampleRates: { traces: 1.0, replaysSession: 0.0, replaysOnError: 1.0 }
};

const sentryEnv = {}; // Potentially for runtime Sentry flags
import { createDomAPI } from './utils/domAPI.js';
const domAPI = createDomAPI({ documentObject: document, windowObject: window });
const storage = window.localStorage; // Keep for Sentry or direct use if unavoidable
const notificationPlaceholder = { log() { }, warn() { }, error() { } }; // Placeholder for Sentry pre-DI
const sentryNamespace = typeof window !== 'undefined' && window.Sentry ? window : { Sentry: undefined };

let notify = null; // Will be the main notification utility instance
let apiRequest = null; // Will be the API client instance
let currentUser = null; // Will hold the current user object
// Assume APP_CONFIG is globally available or imported
// const APP_CONFIG = { ... };

// App state object (consider moving to a dedicated state management module if complex)
const appState = {
    initialized: false,
    initializing: false,
    isAuthenticated: false,
    currentPhase: 'idle',
    // Add other relevant app-wide states here
};

// Global initialization guards
var _globalInitCompleted = false;
var _globalInitInProgress = false;

// ────────────── 1. Construct browserAPI & DependencySystem ──────────────
import * as globalUtils from './utils/globalUtils.js';
import { createBrowserService } from './utils/browserService.js'; // Assuming this exists

const browserAPI = globalUtils.createBrowserAPI(); // Uses domAPI implicitly or explicitly
let DependencySystem = browserAPI.getDependencySystem();

if (!DependencySystem) {
    domAPI.setInnerHTML(document.body, `
    <div style="padding: 2em; text-align: center; color: red; font-family: sans-serif;">
      <strong>Application Critical Error:</strong> Core dependency system failed to load.<br>
      Please contact support or refresh.
    </div>`);
    throw new Error("DependencySystem is required but not available.");
}

DependencySystem.register('domAPI', domAPI); // Register domAPI early
DependencySystem.register('browserAPI', browserAPI);
const browserServiceInstance = createBrowserService({ windowObject: window, domAPI });
DependencySystem.register('browserService', browserServiceInstance);
DependencySystem.register('storage', browserServiceInstance); // browserService can provide storage
/* Register sanitizer (DOMPurify) so downstream modules like Auth can safely
 * use it for innerHTML assignments. We must register an **instance** that
 * exposes a `.sanitize` method, otherwise AuthModule will throw on init.
 */
let sanitizerInstance;
try {
  // In ESM builds DOMPurify exports a factory function; call it with `window`
  // to obtain a configured instance that includes `.sanitize`.
  sanitizerInstance = (typeof DOMPurify === 'function')
    ? DOMPurify(window)
    : DOMPurify;
} catch (err) {
  // Fall back to the raw export if instantiation fails; it should still
  // provide `.sanitize` or AuthModule will surface a clearer error.
  sanitizerInstance = DOMPurify;
}
DependencySystem.register('sanitizer', sanitizerInstance);

/* -----------------------------------------------------------------------
 * API Endpoints – central definition so every module receives same object.
 * Provide sensible defaults; projects/chat endpoints are exposed as helpers.
 * --------------------------------------------------------------------- */
const defaultApiEndpoints = {
  /* --- Auth --- */
  AUTH_CSRF: '/api/auth/csrf/',
  AUTH_LOGIN: '/api/auth/login/',
  AUTH_REGISTER: '/api/auth/register/',
  AUTH_LOGOUT: '/api/auth/logout/',
  AUTH_REFRESH: '/api/auth/refresh/',
  AUTH_VERIFY: '/api/auth/verify/',

  /* --- Projects --- */
  PROJECTS: '/api/projects/',
  DETAIL: (id) => `/api/projects/${id}/`,
  STATS: (id) => `/api/projects/${id}/stats/`,
  FILES: (id) => `/api/projects/${id}/files/`,
  ARTIFACTS: (id) => `/api/projects/${id}/artifacts/`,
  KB: (id) => `/api/projects/${id}/knowledge_base/`,
  ARCHIVE: (id) => `/api/projects/${id}/archive/`,

  /* --- Chat / Conversations --- */
  CONVERSATIONS: (projectId) => `/api/projects/${projectId}/conversations/`,
  CONVERSATION: (projectId, convId) => `/api/projects/${projectId}/conversations/${convId}`,
  MESSAGES: (projectId, convId) => `/api/projects/${projectId}/conversations/${convId}/messages`
};

/* Merge APP_CONFIG.API_ENDPOINTS (if any) to allow environment overrides */
const apiEndpoints = {
  ...defaultApiEndpoints,
  ...(APP_CONFIG?.API_ENDPOINTS || {})
};

DependencySystem.register('apiEndpoints', apiEndpoints);
const waitFor = DependencySystem.waitFor.bind(DependencySystem);

// ────────────── 2. Sentry Initialization (early for error capture) ──────────────
const sentryManager = createSentryManager({
    config: sentryConfig,
    env: sentryEnv,
    domAPI,
    storage, // Sentry might need direct localStorage temporarily
    notification: notificationPlaceholder, // Sentry uses its own internal logging or this placeholder
    navigator: window.navigator,
    window,
    document,
    sentryNamespace
});
sentryManager.initialize(); // Initialize Sentry ASAP
DependencySystem.register('sentryManager', sentryManager);
DependencySystem.register('errorReporter', sentryManager); // Alias for generic error reporting

/*
 * ────────────── 3. Core Services: EventHandlers, NotificationHandler, Notify (in specific order) ──────────────
 * We must ensure createEventHandlers receives a valid (even if placeholder) notify object.
 * This preliminary object provides basic console logging and passes the if (!notify) check.
 * The full notify instance is registered later and picked up via DependencySystem by trackListener or other methods.
 */
import { createEventHandlers } from './eventHandler.js';
import { createNotificationHandler } from './notification-handler.js';
import { createNotify } from './utils/notify.js';

// Create a preliminary/placeholder notify object for eventHandlers' immediate needs.
// This object's methods will be very basic.
// The full 'notify' instance created later will be the primary one used.
const preliminaryNotifyForEventHandlers = {
    debug: (...args) => console.debug('[EH Prelim Notify]', ...args),
    info: (...args) => console.info('[EH Prelim Notify]', ...args),
    warn: (...args) => console.warn('[EH Prelim Notify]', ...args),
    error: (...args) => console.error('[EH Prelim Notify]', ...args),
    success: (...args) => console.info('[EH Prelim Notify]', ...args),
    // It doesn't need withContext for this immediate check,
    // but if createEventHandlers *used* withContext at the top level, it would need a stub.
    // For now, the check is just `if (!notify)`.
};

// Create EventHandlers first.
const eventHandlers = createEventHandlers({
    DependencySystem,
    domAPI,
    browserService: browserServiceInstance,
    notify: preliminaryNotifyForEventHandlers // Pass the preliminary notify object
});
DependencySystem.register('eventHandlers', eventHandlers);

// Create NotificationHandler. It needs the eventHandlers instance.
const notificationHandler = createNotificationHandler({
    eventHandlers, // Pass the created instance
    DependencySystem,
    domAPI,
    groupWindowMs: 7000 // Example config
});
DependencySystem.register('notificationHandler', notificationHandler);

// Create the main Notify utility. It needs the notificationHandler instance.
notify = createNotify({ notificationHandler, sentry: sentryManager, DependencySystem });
DependencySystem.register('notify', notify);

// Now that 'notify' is registered, eventHandlers can use it fully if its methods are called.

// ────────────── 4. Application Modules (DI-based) ──────────────
import { createChatManager } from './chat.js';
import { createAuthModule } from './auth.js';
import { createProjectManager } from './projectManager.js';
import { createProjectModal, createModalManager } from './modalManager.js'; // Assuming this is different from core modalManager
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
// ... other imports

// Application object (namespace for some core functionalities)
const app = {
    getProjectId: () => { /* ... logic to get project ID ... */
        const params = new URLSearchParams(browserAPI.getLocation().search);
        return params.get('project');
    },
    navigateToConversation: async (chatId) => {
        const chatMgr = await waitFor('chatManager');
        if (chatMgr && typeof chatMgr.loadConversation === 'function') {
            return chatMgr.loadConversation(chatId);
        }
        notify?.warn?.('[App] ChatManager not available for navigateToConversation', { context: 'app', module: 'App', source: 'navigateToConversation' });
        return false;
    },
    // Other app-specific helpers can go here
};
DependencySystem.register('app', app);


// Main application initialization function
async function init() {
    const _initStart = performance.now();

    if (_globalInitCompleted || _globalInitInProgress) {
        notify?.warn?.('[App] Duplicate initialization attempt blocked by global guard.', {
            group: true, context: 'app', module: 'App', phase: 'guard',
            globalInitCompleted: _globalInitCompleted, globalInitInProgress: _globalInitInProgress
        });
        return _globalInitCompleted;
    }

    if (appState.initialized || appState.initializing) {
        notify?.info?.('[App] Initialization attempt skipped (already done or in progress via appState).', {
            group: true, context: 'app', module: 'App', phase: 'guard',
            appStateInitialized: appState.initialized, appStateInitializing: appState.initializing
        });
        return appState.initialized;
    }

    _globalInitInProgress = true;
    appState.initializing = true; // Set app state initializing flag
    appState.currentPhase = 'starting_init_process';

    notify?.debug?.('[App] START init function', { context: 'app', module: 'App', source: 'init', phase: appState.currentPhase });

    // API Client (now uses the fully initialized notify)
    notify?.debug?.('[App] Creating API Client...', { context: 'app', module: 'App', source: 'init' });
    apiRequest = globalUtils.createApiClient({
        APP_CONFIG,
        globalUtils,
        notificationHandler: notify, // Pass the main notify utility
        getAuthModule: () => DependencySystem.modules.get('auth'),
        browserAPI
    });
    DependencySystem.register('apiRequest', apiRequest);
    app.apiRequest = apiRequest; // Also attach to app namespace if needed for convenience/legacy
    notify?.debug?.('[App] API Client CREATED.', { context: 'app', module: 'App', source: 'init' });

    // Chat Manager
    notify?.debug?.('[App] Creating Chat Manager...', { context: 'app', module: 'App', source: 'init' });
    const chatBrowserAPI = DependencySystem.modules.get('browserAPI');
    const chatManager = createChatManager({ // Ensure all dependencies are resolved correctly
        DependencySystem,
        apiRequest,
        auth: () => DependencySystem.modules.get('auth'),
        eventHandlers,
        app,
        domAPI,
        navAPI: { /* ... navAPI methods using chatBrowserAPI ... */
            getSearch: () => chatBrowserAPI.getLocation().search,
            getHref: () => chatBrowserAPI.getLocation().href,
            pushState: (url, title = '') => chatBrowserAPI.getHistory().pushState({}, title, url),
            getPathname: () => chatBrowserAPI.getLocation().pathname
        },
        isValidProjectId: globalUtils.isValidProjectId,
        isAuthenticated: () => {
            const authModule = DependencySystem.modules.get('auth');
            return typeof authModule?.isAuthenticated === 'function' ? authModule.isAuthenticated() : false;
        },
        DOMPurify: DependencySystem.modules.get('sanitizer'), // Assuming sanitizer is registered
        apiEndpoints: DependencySystem.modules.get('apiEndpoints'), // Assuming registered
        notificationHandler: notify // Pass the main notify utility
    });
    if (!chatManager || typeof chatManager.initialize !== 'function') {
        notify?.error?.('[App] createChatManager() did not return a valid ChatManager instance.', { group: true, context: 'app', module: 'App', source: 'init', phase: 'module_creation' });
        throw new Error('[App] createChatManager() failed.');
    }
    DependencySystem.register('chatManager', chatManager); // Register the instance
    notify?.debug?.('[App] Chat Manager CREATED and registered.', { context: 'app', module: 'App', source: 'init' });
    // The check for `regChatManager === createChatManager` is removed as we now ensure instance registration.

    // Event listener for clearing non-sticky notifications on location change
    document.addEventListener('locationchange', function () {
        const container = notify.getContainer?.() || domAPI.getElementById('notificationArea');
        if (container) {
            const notificationsToKeep = Array.from(domAPI.getChildren(container)).filter(
                el => domAPI.hasClass(el, 'priority') || domAPI.hasClass(el, 'sticky')
            );
            notify.clearNonSticky?.(); // Assuming notify has a method for this
            // Or, manually:
            // notify.clear();
            // notificationsToKeep.forEach(el => domAPI.appendChild(container, el));
        }
    });

    notify?.debug?.('[App] Initializing application core systems and UI...', { context: 'app', module: 'App', source: 'init', phase: 'core_init_start' });
    globalUtils.toggleElement(APP_CONFIG.SELECTORS.APP_LOADING_SPINNER, true); // Ensure selector is valid
    const initStartTime = performance.now();

    try {
        appState.currentPhase = 'init_core_systems';
        notify?.debug?.(`[App] Phase: ${appState.currentPhase} - STARTING`, { group: true, context: 'app', module: 'App', source: 'init', phase: appState.currentPhase });
        await initializeCoreSystems();
        notify?.debug?.(`[App] Phase "${appState.currentPhase}" completed in ${(performance.now() - initStartTime).toFixed(2)} ms`, { group: true, context: 'app', module: 'App', source: 'init', phase: appState.currentPhase });

        appState.currentPhase = 'waiting_core_deps';
        notify?.debug?.(`[App] Phase: ${appState.currentPhase}, waiting for DI deps`, { group: true, context: 'app', module: 'App', source: 'init', phase: appState.currentPhase });
        await waitFor(['auth', 'eventHandlers', 'notificationHandler', 'modalManager'], null, APP_CONFIG.TIMEOUTS.DEPENDENCY_WAIT);

        appState.currentPhase = 'init_auth';
        const _authInitStart = performance.now();
        notify?.debug?.(`[App] Phase: ${appState.currentPhase} - STARTING`, { group: true, context: 'app', module: 'App', source: 'init', phase: appState.currentPhase });
        await initializeAuthSystem();
        notify?.debug?.(`[App] Phase "${appState.currentPhase}" completed in ${(performance.now() - _authInitStart).toFixed(2)} ms`, { group: true, context: 'app', module: 'App', source: 'init', phase: appState.currentPhase });

        if (appState.isAuthenticated) {
            notify?.debug?.(`[App] User is authenticated; fetching current user`, { group: true, context: 'app', module: 'App', source: 'init', phase: appState.currentPhase });
            const _currUserStart = performance.now();
            currentUser = await fetchCurrentUser(); // Implement fetchCurrentUser
            if (currentUser) {
                browserAPI.setCurrentUser(currentUser); // If browserAPI supports this
                DependencySystem.register('currentUser', currentUser);
                notify?.info?.(`[App] Current user loaded`, { group: true, context: 'app', module: 'App', source: 'init', user: currentUser, ms: (performance.now() - _currUserStart).toFixed(2) });
            } else {
                notify?.warn?.(`[App] No current user found (was expected)`, { group: true, context: 'app', module: 'App', source: 'init', phase: appState.currentPhase, ms: (performance.now() - _currUserStart).toFixed(2) });
            }
        }

        appState.currentPhase = 'init_ui';
        const _uiStart = performance.now();
        notify?.debug?.(`[App] Phase: ${appState.currentPhase} - STARTING`, { group: true, context: 'app', module: 'App', source: 'init', phase: appState.currentPhase });
        await initializeUIComponents();
        notify?.debug?.(`[App] Phase "${appState.currentPhase}" completed in ${(performance.now() - _uiStart).toFixed(2)} ms`, { group: true, context: 'app', module: 'App', source: 'init', phase: appState.currentPhase });

        appState.currentPhase = 'registering_listeners';
        const _listenersStart = performance.now();
        notify?.debug?.(`[App] Phase: ${appState.currentPhase} - STARTING`, { group: true, context: 'app', module: 'App', source: 'init', phase: appState.currentPhase });
        registerAppListeners();
        notify?.debug?.(`[App] Phase "${appState.currentPhase}" completed in ${(performance.now() - _listenersStart).toFixed(2)} ms`, { group: true, context: 'app', module: 'App', source: 'init', phase: appState.currentPhase });

        appState.currentPhase = 'finalizing';
        notify?.debug?.(`[App] Phase: ${appState.currentPhase} - STARTING sub-tasks`, { group: true, context: 'app', module: 'App', source: 'init', phase: appState.currentPhase });

        // Initialize eventHandlers explicitly (single, robust call)
        try {
            const eh = DependencySystem.modules.get('eventHandlers');
            if (eh && typeof eh.init === 'function') {
                notify?.debug?.('[App] Initializing eventHandlers explicitly', { group: true, context: 'app', module: 'App', source: 'init', phase: appState.currentPhase });
                await eh.init(); // This is the main init call for eventHandlers
                notify?.info?.('[App] EventHandlers initialized successfully', { group: true, context: 'app', module: 'App', source: 'init', phase: appState.currentPhase });
            } else {
                notify?.error?.('[App] eventHandlers.init is not a function or module not found.', { group: true, context: 'app', module: 'App', source: 'init', phase: appState.currentPhase });
            }
        } catch (ehErr) {
            notify?.error?.('[App] Error initializing eventHandlers', { group: true, context: 'app', module: 'App', source: 'init', phase: appState.currentPhase, error: ehErr });
        }

        // Initialize modelConfig UI if available
        try {
            const mc = DependencySystem.modules.get('modelConfig');
            if (mc && typeof mc.initializeUI === 'function') {
                mc.initializeUI();
                notify?.debug?.('[App] modelConfig UI initialized.', { context: 'app', module: 'App', source: 'init', phase: appState.currentPhase });
            }
        } catch (mcErr) {
            notify?.warn?.('[App] Error initializing modelConfig UI', { group: true, context: 'app', module: 'App', source: 'init', phase: appState.currentPhase, error: mcErr });
        }

        notify?.debug?.('[App] Calling handleNavigationChange() during finalization', { group: true, context: 'app', module: 'App', source: 'init', phase: appState.currentPhase });
        handleNavigationChange(); // Initial navigation handling

        appState.initialized = true; // Set app state initialized flag
        const initEndTime = performance.now();
        const totalMs = initEndTime - initStartTime;
        notify?.info?.(
            `[App] Initialization complete in ${totalMs.toFixed(2)} ms.`,
            { group: true, context: 'app', module: 'App', source: 'init', phase: appState.currentPhase, ms: totalMs, authenticated: appState.isAuthenticated }
        );
        if (totalMs > APP_CONFIG.PERFORMANCE_THRESHOLDS?.INIT_WARN || 3000) { // Use configured threshold
            notify?.warn?.(`[App] Initialization exceeded perf warning threshold: ${totalMs.toFixed(1)} ms`, { group: true, context: 'app', module: 'App', source: 'init', ms: totalMs });
        }

        _globalInitCompleted = true;
        domAPI.dispatchEvent(document, new CustomEvent('appInitialized', { detail: { success: true } }));
        return true;

    } catch (err) {
        notify?.error?.('[App] CRITICAL ERROR in main init() try block.', { group: true, context: 'app', module: 'App', source: 'init', error: err, phase: appState.currentPhase, errorStack: err?.stack });
        handleInitError(err);
        domAPI.dispatchEvent(document, new CustomEvent('appInitialized', { detail: { success: false, error: err } }));
        return false;
    } finally {
        const totalFinalMs = performance.now() - _initStart;
        notify?.debug?.(`[App] init() finally block. Total execution: ${totalFinalMs.toFixed(1)} ms. Hiding spinner.`, { group: true, context: 'app', module: 'App', source: 'init', phase: appState.currentPhase, ms: totalFinalMs });
        _globalInitInProgress = false;
        appState.initializing = false; // Reset app state initializing flag
        globalUtils.toggleElement(APP_CONFIG.SELECTORS.APP_LOADING_SPINNER, false);
        appState.currentPhase = appState.initialized ? 'initialized_idle' : 'failed_idle';
    }
}

async function initializeCoreSystems() {
    notify?.debug?.('[App] Initializing core systems...', { context: 'app', module: 'App', source: 'initializeCoreSystems' });

    if (document.readyState !== 'complete' && document.readyState !== 'interactive') {
        await new Promise(resolve => {
            domAPI.addEventListener(document, 'DOMContentLoaded', resolve, { once: true });
        });
    }
    notify?.getContainer?.(); // Ensure notification container is ready or created by handler

    // ModalManager
    const modalManager = createModalManager({ domAPI, browserService: browserServiceInstance, eventHandlers, DependencySystem, modalMapping: MODAL_MAPPINGS, notify });
    DependencySystem.register('modalManager', modalManager);
    window.modalManager = modalManager; // Keep for legacy/debug if absolutely needed, prefer DI

    // AuthModule
    // Ensure dependencies for createAuthModule are available via DI or passed directly
    const authModule = createAuthModule({
        apiRequest,
        notify,
        eventHandlers,
        domAPI, // Pass the domAPI instance
        sanitizer: DependencySystem.modules.get('sanitizer'), // Assuming sanitizer is registered
        modalManager,
        apiEndpoints: DependencySystem.modules.get('apiEndpoints') // Assuming registered
    });
    DependencySystem.register('auth', authModule);

    // ProjectManager
    const projectManager = createProjectManager({
        DependencySystem,
        chatManager: () => DependencySystem.modules.get('chatManager'), // Lazy load chatManager
        app,
        notify,
        apiEndpoints: DependencySystem.modules.get('apiEndpoints'),
        storage: DependencySystem.modules.get('storage'),
        listenerTracker: { /* ... listenerTracker using eventHandlers ... */
            add: (target, event, handler, description) =>
                eventHandlers.trackListener(target, event, handler, {
                    description: description || `[ProjectManager] ${event} on ${target?.id || target}`,
                    module: 'ProjectManager', // Add module context for eventHandlers
                    context: 'projectManagerEvents'
                }),
            remove: (target, event, handler) => eventHandlers.cleanupListeners({ targetElement: target, targetType: event, targetHandler: handler, context: 'projectManagerEvents' })
        }
    });
    DependencySystem.register('projectManager', projectManager);

    // ProjectModal (specific modal, distinct from modalManager)
    const projectModal = createProjectModal({ DependencySystem, eventHandlers, notify, domAPI, browserService: browserServiceInstance });
    DependencySystem.register('projectModal', projectModal);


    // Modal HTML Loading (robust handling)
    // This assumes base.html or similar dispatches 'modalsLoaded'
    // Or projectModal.init() handles its own HTML loading if needed.
    const modalsReadyPromise = new Promise((resolve, reject) => {
        const initialTimeout = setTimeout(() => {
            notify?.warn?.('[App] Modal HTML loading taking >5s.', { group: true, context: "app", module: "App", source: "initializeCoreSystems.modalsReady" });
        }, 5000);
        const hardTimeout = setTimeout(() => {
            notify?.error?.('[App] TIMEOUT: Modal HTML failed to load/signal in 15s.', { group: true, context: "app", module: "App", source: "initializeCoreSystems.modalsReady" });
            resolve(false); // Resolve false on hard timeout
        }, 15000);

        const modalsLoadedHandler = (event) => {
            clearTimeout(initialTimeout);
            clearTimeout(hardTimeout);
            notify?.debug?.('[App] Received modalsLoaded event.', { group: true, context: 'app', module: 'App', source: 'initializeCoreSystems.modalsReady', detail: event?.detail });
            resolve(true);
        };
        // Use eventHandlers to track this crucial listener
        eventHandlers.trackListener(document, 'modalsLoaded', modalsLoadedHandler, { once: true, description: '[App] Modal HTML loader handler', context: 'appInit', module: 'App' });
    });

    const modalsLoaded = await modalsReadyPromise;
    if (!modalsLoaded) {
        notify?.error?.('[App] Modal loading signal not received or timed out. UI may be incomplete.', { group: true, context: 'app', module: 'App', source: 'initializeCoreSystems' });
    } else {
        // Specific modal form setup after modals are confirmed loaded
        const projectForm = domAPI.getElementById('projectModalForm');
        if (projectForm) {
            // Setup project form submission using eventHandlers.setupForm or projectModal.init()
            // For example, if projectModal has an init:
            const pmInstance = DependencySystem.modules.get('projectModal');
            if (pmInstance && typeof pmInstance.initForm === 'function') {
                pmInstance.initForm(); // Assuming initForm sets up the submit handler
            } else {
                // Manual setup as fallback (simplified example)
                eventHandlers.trackListener(projectForm, 'submit', async (e) => {
                    domAPI.preventDefault(e);
                    // ... (form submission logic from original snippet, adapted for DI)
                    const formData = new FormData(projectForm);
                    const data = Object.fromEntries(formData.entries());
                    // ... validation ...
                    try {
                        const projMgr = DependencySystem.modules.get('projectManager');
                        await projMgr.saveProject(data.projectId, data); // Or createProject
                        notify?.success?.('Project saved.', { context: 'projectModal' });
                        DependencySystem.modules.get('modalManager').hide('project');
                        projMgr.loadProjects?.('all');
                    } catch (err) {
                        notify?.error?.('Failed to save project.', { context: 'projectModal', error: err });
                    }
                }, { description: 'Project Modal Form Submit', module: 'App', context: 'projectModal' });
            }
        } else {
            notify?.warn?.('[App] projectModalForm not found after modalsLoaded signal.', { context: 'app', module: 'App', source: 'initializeCoreSystems' });
        }
    }


    // Initialize modules that have an `init` or `initialize` method
    if (typeof modalManager.init === 'function') modalManager.init();
    // No eventHandlersMod.init() here; it's handled in main init()
    if (appState.isAuthenticated) { // Only init chatManager if authenticated
        const chatMgrInstance = DependencySystem.modules.get('chatManager');
        if (chatMgrInstance && typeof chatMgrInstance.initialize === 'function') {
            notify?.debug?.('[App] Initializing ChatManager (authenticated user)...', { context: 'app', module: 'App', source: 'initializeCoreSystems' });
            await chatMgrInstance.initialize({ projectId: app.getProjectId() }); // Pass initial project ID if available
        }
    }
    if (typeof projectManager.initialize === 'function') await projectManager.initialize();
    if (typeof projectModal.init === 'function') projectModal.init();


    notify?.debug?.('[App] Core systems initialized.', { context: 'app', module: 'App', source: 'initializeCoreSystems' });
}

async function initializeAuthSystem() {
    notify?.debug?.('[App] Initializing authentication system...', { context: 'app', module: 'App', source: 'initializeAuthSystem' });
    const auth = DependencySystem.modules.get('auth');
    if (!auth || typeof auth.init !== 'function') {
        throw new Error("[App] Auth module is missing, invalid, or lacks init method in DependencySystem.");
    }
    try {
        await auth.init();
        appState.isAuthenticated = auth.isAuthenticated();
        notify?.debug?.(`[App] Initial authentication state: ${appState.isAuthenticated}`, { context: 'app', module: 'App', source: 'initializeAuthSystem' });
        const bus = auth.AuthBus; // Assuming AuthBus is exposed by auth module
        if (bus && typeof eventHandlers.trackListener === 'function') {
            eventHandlers.trackListener(bus, 'authStateChanged', handleAuthStateChange, // handleAuthStateChange defined later
                { description: '[App] AuthBus authStateChanged listener', module: 'App', context: 'authEvents' }
            );
        }
        renderAuthHeader(); // Defined later
    } catch (err) {
        appState.isAuthenticated = false;
        notify?.error?.('[App] Auth system initialization failed.', { group: true, context: 'app', module: 'App', source: 'initializeAuthSystem', error: err });
        throw new Error(`[App] initializeAuthSystem failed: ${err.message}`);
    }
}

let _uiComponentsInitialized = false;
async function initializeUIComponents() {
    if (_uiComponentsInitialized) {
        notify?.warn?.('[App] initializeUIComponents called again, skipping.', { context: 'app', module: 'App', source: 'initializeUIComponents' });
        return;
    }
    notify?.debug?.('[App] Initializing UI components...', { context: 'app', module: 'App', source: 'initializeUIComponents' });

    // Ensure essential DOM structure for project list/details view
    // This could be part of base HTML or created dynamically if missing
    let projectListView = domAPI.getElementById('projectListView');
    if (!projectListView) {
        projectListView = domAPI.createElement('div');
        domAPI.setAttribute(projectListView, 'id', 'projectListView');
        domAPI.addClass(projectListView, 'w-full'); // Example class
        domAPI.appendChild(document.body, projectListView); // Or a main app container
    }
    // Similar for projectDetailsView

    // Inject HTML partials robustly
    const injectHTML = async (url, container, requiredId, name) => {
        notify?.debug?.(`[App] Injecting ${name} HTML from ${url}...`, { context: 'app', module: 'App', source: 'initializeUIComponents' });
        if (domAPI.getElementById(requiredId)) {
            notify?.debug?.(`[App] ${name} HTML (#${requiredId}) already present.`, { context: 'app', module: 'App', source: 'initializeUIComponents' });
            return true;
        }
        try {
            const resp = await fetch(url, { cache: 'reload' }); // Consider cache policy for prod
            if (!resp.ok) throw new Error(`HTTP ${resp.status} for ${url}`);
            const html = await resp.text();
            if (!html || !html.includes(`id="${requiredId}"`)) throw new Error(`Fetched ${url} missing #${requiredId}`);
            domAPI.setInnerHTML(container, html);
            if (!domAPI.getElementById(requiredId)) throw new Error(`Injected ${url} but #${requiredId} still missing!`);
            notify?.debug?.(`[App] ${name} HTML injection complete.`, { context: 'app', module: 'App', source: 'initializeUIComponents' });
            return true;
        } catch (err) {
            notify?.error?.(`Failed to load/inject ${name} UI: ${err.message}`, { group: true, context: "app", module: "App", source: "initializeUIComponents" });
            throw err; // Re-throw to halt initialization if critical
        }
    };

    // Await injectHTML('/static/html/project_list.html', projectListView, 'projectList', 'Project List');
    // Await injectHTML('/static/html/project_details.html', projectDetailsView, 'projectDetails', 'Project Details');
    // The above is only if not part of base.html. If base.html loads them, rely on that.

    if (FileUploadComponent) {
        DependencySystem.register('FileUploadComponent', FileUploadComponent);
    }

    const chatExtensionsInstance = createChatExtensions({ DependencySystem, eventHandlers, notificationHandler: notify });
    DependencySystem.register('chatExtensions', chatExtensionsInstance);

    const modelConfigInstance = createModelConfig({ DependencySystem, notify }); // Pass deps
    DependencySystem.register('modelConfig', modelConfigInstance);

    const projectDashboardUtilsInstance = createProjectDashboardUtils({ DependencySystem }); // Relies on DS to get other deps
    DependencySystem.register('projectDashboardUtils', projectDashboardUtilsInstance);

    // The projectListComponent and projectDetailsComponent expect their container elements to exist.
    const projectListComponentInstance = new ProjectListComponent({
        projectManager: () => DependencySystem.modules.get('projectManager'),
        eventHandlers,
        modalManager: () => DependencySystem.modules.get('modalManager'),
        app,
        router: { /* ... router using browserAPI/browserService ... */
            navigate: (url) => browserAPI.getHistory().pushState({}, '', url) && domAPI.dispatchEvent(window, new Event('locationchange')),
            getURL: () => browserAPI.getLocation().href
        },
        notify,
        storage: DependencySystem.modules.get('storage'),
        sanitizer: DependencySystem.modules.get('sanitizer'),
        domAPI // Pass domAPI
    });
    DependencySystem.register('projectListComponent', projectListComponentInstance);

    // Create ProjectDashboard (the main UI orchestrator for projects)
    const projectDashboardInstance = createProjectDashboard({ DependencySystem }); // Pass DS
    DependencySystem.register('projectDashboard', projectDashboardInstance); // Register instance

    const projectDetailsComponentInstance = createProjectDetailsComponent({
        projectManager: () => DependencySystem.modules.get('projectManager'),
        eventHandlers,
        modalManager: () => DependencySystem.modules.get('modalManager'),
        FileUploadComponentClass: () => DependencySystem.modules.get('FileUploadComponent'),
        router: { /* ... router using browserAPI/browserService ... */ },
        domAPI,
        notify,
        sanitizer: DependencySystem.modules.get('sanitizer'),
        app, // Pass app
        onBack: async () => { // Example onBack
            const pd = await waitFor('projectDashboard');
            pd?.showProjectList?.();
        }
    });
    DependencySystem.register('projectDetailsComponent', projectDetailsComponentInstance);

    const sidebarInstance = createSidebar({ DependencySystem, eventHandlers, app, projectDashboard: projectDashboardInstance, projectManager: () => DependencySystem.modules.get('projectManager'), notify, storageAPI: DependencySystem.modules.get('storage'), domAPI, viewportAPI: { getInnerWidth: () => window.innerWidth } });
    DependencySystem.register('sidebar', sidebarInstance);

    DependencySystem.register('utils', globalUtils); // If globalUtils is a collection of functions

    const knowledgeBaseComponentInstance = createKnowledgeBaseComponent({ DependencySystem, apiRequest, auth: () => DependencySystem.modules.get('auth'), projectManager: () => DependencySystem.modules.get('projectManager'), uiUtils: globalUtils, sanitizer: DependencySystem.modules.get('sanitizer') });
    DependencySystem.register('knowledgeBaseComponent', knowledgeBaseComponentInstance);

    // Initialize UI modules that have an `init` or `initialize` method
    if (typeof sidebarInstance.init === 'function') await sidebarInstance.init();
    if (typeof chatExtensionsInstance.init === 'function') chatExtensionsInstance.init();
    // modelConfig.initializeUI is called in main init's finalization phase
    if (typeof knowledgeBaseComponentInstance.initialize === 'function') await knowledgeBaseComponentInstance.initialize();
    if (typeof projectDashboardInstance.initialize === 'function') await projectDashboardInstance.initialize();
    if (typeof projectListComponentInstance.initialize === 'function') await projectListComponentInstance.initialize();
    if (typeof projectDetailsComponentInstance.initialize === 'function') await projectDetailsComponentInstance.initialize();


    if (appState.isAuthenticated) {
        const pm = DependencySystem.modules.get('projectManager');
        if (pm?.loadProjects) {
            notify?.debug?.('[App] Loading projects (UI init, authenticated)...', { context: 'app', module: 'App', source: 'initializeUIComponents' });
            pm.loadProjects('all').catch(err => {
                notify?.error?.('[App] Failed to load projects during UI initialization.', { group: true, context: 'app', module: 'App', error: err });
            });
        }
    } else {
        notify?.warn?.('[App] Not authenticated, skipping initial project load in UI init.', { context: 'app', module: 'App', source: 'initializeUIComponents' });
    }

    // Accessibility and other global UI enhancements
    if (typeof window.initAccessibilityEnhancements === 'function') window.initAccessibilityEnhancements({ domAPI, notify });
    if (typeof window.initSidebarEnhancements === 'function') window.initSidebarEnhancements({ domAPI, notify, eventHandlers });

    _uiComponentsInitialized = true;
    notify?.debug?.('[App] UI components initialized.', { context: 'app', module: 'App', source: 'initializeUIComponents' });
}

function renderAuthHeader() {
    try {
        // const browserAPI = DependencySystem.modules.get('browserAPI'); // Not needed if using domAPI
        const authMod = DependencySystem.modules.get('auth');
        const isAuth = authMod?.isAuthenticated?.();

        const btn = domAPI.querySelector(APP_CONFIG.SELECTORS.AUTH_BUTTON) || domAPI.getElementById('loginButton');
        if (btn) {
            domAPI.setTextContent(btn, isAuth ? 'Logout' : 'Login');
            // Remove previous listeners before adding new ones if this can be called multiple times
            // eventHandlers.cleanupListeners({targetElement: btn, targetType: 'click'}); // If specific cleanup needed
            eventHandlers.trackListener(btn, 'click', (e) => {
                domAPI.preventDefault(e);
                if (isAuth) authMod.logout();
                else DependencySystem.modules.get('modalManager')?.show('login');
            }, { description: '[App] Auth login/logout button', module: 'App', context: 'authHeader' });
        }
        const authStatus = domAPI.querySelector(APP_CONFIG.SELECTORS.AUTH_STATUS_SPAN);
        const userStatus = domAPI.querySelector(APP_CONFIG.SELECTORS.USER_STATUS_SPAN);
        if (authStatus) domAPI.setTextContent(authStatus, isAuth ? 'Signed in' : 'Not signed in');
        if (userStatus) domAPI.setTextContent(userStatus, isAuth && currentUser ? `Hello, ${currentUser.name || currentUser.username}` : ''); // Use currentUser
    } catch (err) {
        notify?.error?.('[App] Error rendering auth header.', { context: 'app', module: 'App', source: 'renderAuthHeader', error: err });
    }
}

async function fetchCurrentUser() {
    // Placeholder: Implement actual API call to fetch user details
    try {
        const authModule = DependencySystem.modules.get('auth');
        if (authModule?.getCurrentUserAsync) return await authModule.getCurrentUserAsync();
        if (authModule?.getCurrentUser) return authModule.getCurrentUser(); // Sync fallback
        // Fallback to direct API call if auth module doesn't provide it
        // const response = await apiRequest(APP_CONFIG.API_ENDPOINTS.CURRENT_USER);
        // return response.data.user;
        notify?.warn?.('[App] fetchCurrentUser: No method found on auth module.', { context: 'app', module: 'App' });
        return null;
    } catch (error) {
        notify?.error?.('[App] Failed to fetch current user', { context: 'app', module: 'App', source: 'fetchCurrentUser', error });
        return null;
    }
}


function registerAppListeners() {
    notify?.debug?.('[App] Registering global application listeners...', { context: 'app', module: 'App', source: 'registerAppListeners' });
    waitFor(['auth', 'chatManager', 'projectManager', 'eventHandlers'], () => {
        // Auth state changes are handled in initializeAuthSystem via AuthBus
        setupChatInitializationTrigger(); // Defined below
        eventHandlers.trackListener(window, 'locationchange', handleNavigationChange, { // handleNavigationChange defined below
            description: 'Global locationchange event', module: 'App', context: 'navigation'
        });
    }).catch(err => {
        notify?.error?.('[App] Failed to wait for dependencies for global listeners.', { group: true, context: 'app', module: 'App', source: 'registerAppListeners', error: err });
    });
    notify?.debug?.('[App] Global application listeners registered.', { context: 'app', module: 'App', source: 'registerAppListeners' });
}

function setupChatInitializationTrigger() {
    const requiredDeps = ['auth', 'chatManager', 'projectManager', 'notify', 'eventHandlers']; // Add notify, eventHandlers
    const debouncedInitChat = globalUtils.debounce(async (arg = null) => {
        let forceProjectId = null;
        if (arg && typeof arg === 'object' && arg.detail?.project?.id) {
            forceProjectId = arg.detail.project.id;
        } else if (typeof arg === 'string' && globalUtils.isValidProjectId(arg)) {
            forceProjectId = arg;
        }

        try {
            const [authMod, chatMgr, projMgr, localNotify, localEventHandlers] = await waitFor(requiredDeps, null, APP_CONFIG.TIMEOUTS.DEPENDENCY_WAIT / 2);
            if (!authMod || !chatMgr || !projMgr || !localNotify || !localEventHandlers) {
                localNotify?.warn?.('[App] Chat init trigger: Missing core dependencies.', { group: true, context: 'app', module: 'App', source: 'debouncedInitChat' });
                return;
            }

            const currentAppProjectId = app.getProjectId();
            const finalProjectId = forceProjectId ?? currentAppProjectId ?? projMgr.currentProject?.id ?? null;

            if (authMod.isAuthenticated()) {
                if (finalProjectId && globalUtils.isValidProjectId(finalProjectId)) {
                    localNotify?.debug?.(`[App] Debounced chat init: Initializing for project ${finalProjectId}`, { group: true, context: 'app', module: 'App', source: 'debouncedInitChat' });
                    await chatMgr.initialize({ projectId: finalProjectId });
                } else {
                    localNotify?.debug?.(`[App] Debounced chat init: Authenticated but no valid project ID (${finalProjectId}). Clearing chat.`, { group: true, context: 'app', module: 'App', source: 'debouncedInitChat' });
                    chatMgr.clear?.();
                }
            } else {
                localNotify?.debug?.(`[App] Debounced chat init: Not authenticated. Clearing chat.`, { group: true, context: 'app', module: 'App', source: 'debouncedInitChat' });
                chatMgr.clear?.();
            }
        } catch (err) {
            DependencySystem.modules.get('notify')?.error?.(`[App] Error in debounced chat initialization: ${err?.message}`, {
                group: true, context: 'app', module: 'App', source: 'debouncedInitChat', error: err
            });
        }
    }, 350);

    waitFor(requiredDeps, (resolvedDeps) => {
        const localEventHandlers = resolvedDeps[4]; // eventHandlers instance from waitFor
        const authMod = resolvedDeps[0];

        if (authMod.AuthBus) { // Check if AuthBus exists
            attachAuthBusListener('authStateChanged', debouncedInitChat, '_globalChatInitAuthAttached');
        } else {
            DependencySystem.modules.get('notify')?.warn?.('[App] AuthBus not found on auth module, cannot attach authStateChanged for chat init.', { context: 'app', module: 'App' });
        }

        if (!document._chatInitProjListenerAttached) { // Use a local flag if possible, or manage via eventHandlers state
            localEventHandlers.trackListener(document, 'currentProjectChanged', () => debouncedInitChat(),
                { description: 'Current project changed -> reinit chat', module: 'App', context: 'chatTrigger' });
            document._chatInitProjListenerAttached = true; // Example of a simple guard
        }
        localEventHandlers.trackListener(document, 'currentProjectReady', e => debouncedInitChat(e.detail?.project?.id),
            { description: 'Project ready -> reinit chat', module: 'App', context: 'chatTrigger' });

        debouncedInitChat(); // Initial attempt
    }, APP_CONFIG.TIMEOUTS.DEPENDENCY_WAIT * 2)
        .catch(err => {
            DependencySystem.modules.get('notify')?.error?.('[App] Failed setup for chat init triggers.', { group: true, context: 'app', module: 'App', source: 'setupChatInitializationTrigger', error: err });
        });
}


let lastHandledProj = null;
let lastHandledChat = null;
async function handleNavigationChange() {
    const localNotify = DependencySystem.modules.get('notify'); // Get fresh notify
    if (!appState.initialized) {
        if (appState.initializing) {
            await new Promise(r => setTimeout(r, 150)); // Wait briefly if initializing
            if (!appState.initialized) {
                localNotify?.warn?.("[App] handleNavigationChange: Aborted, initialization didn't complete in time.", { context: 'app', module: 'App', source: 'handleNavigationChange' });
                return;
            }
        } else {
            localNotify?.warn?.("[App] handleNavigationChange: Aborted, application not initialized.", { context: 'app', module: 'App', source: 'handleNavigationChange' });
            return;
        }
    }

    const currentUrl = browserAPI.getLocation().href;
    localNotify?.debug?.(`[App] Handling navigation change. URL: ${currentUrl}`, { context: 'app', module: 'App', source: 'handleNavigationChange' });

    let projectDashboard;
    try {
        projectDashboard = await waitFor('projectDashboard', null, APP_CONFIG.TIMEOUTS.DEPENDENCY_WAIT);
    } catch (e) {
        localNotify?.error?.('[App] Project Dashboard unavailable for navigation.', { group: true, context: 'app', module: 'App', source: 'handleNavigationChange', error: e });
        globalUtils.toggleElement(APP_CONFIG.SELECTORS.APP_FATAL_ERROR, true); // Ensure selector exists
        const errorEl = domAPI.querySelector(APP_CONFIG.SELECTORS.APP_FATAL_ERROR);
        if (errorEl) domAPI.setTextContent(errorEl, 'Core UI component failed to load for navigation. Please refresh.');
        return;
    }

    const url = new URL(currentUrl);
    const projectId = url.searchParams.get('project');
    const chatId = url.searchParams.get('chatId') || null;

    if (projectId === lastHandledProj && chatId === lastHandledChat && appState.initialized) {
        localNotify?.debug?.('[App] handleNavigationChange: Same project/chat and app initialized; skipping full re-load.', { context: 'app', module: 'App', source: 'handleNavigationChange' });
        return;
    }
    lastHandledProj = projectId;
    lastHandledChat = chatId;

    if (!appState.isAuthenticated) {
        localNotify?.debug?.('[App] Navigation change: User not authenticated. Showing login required.', { context: 'app', module: 'App', source: 'handleNavigationChange' });
        projectDashboard.showLoginRequiredMessage?.();
        return;
    }
    globalUtils.toggleElement(APP_CONFIG.SELECTORS.LOGIN_REQUIRED_MESSAGE, false); // Ensure selector exists

    try {
        const projectManager = await waitFor('projectManager', null, APP_CONFIG.TIMEOUTS.DEPENDENCY_WAIT);
        if (projectId && globalUtils.isValidProjectId(projectId)) {
            localNotify?.debug?.(`[App] Navigating to project details: ${projectId}, chatId=${chatId ?? 'none'}`, { context: 'app', module: 'App', source: 'handleNavigationChange' });
            await projectManager.loadProjectDetails(projectId); // Ensure details are loaded
            await projectDashboard.showProjectDetails(projectId); // Show the view

            if (chatId) { // If there's a chatId, attempt to load it
                localNotify?.debug?.(`[App] Attempting to load conversation: ${chatId}`, { context: 'app', module: 'App', source: 'handleNavigationChange' });
                const success = await app.navigateToConversation(chatId);
                if (!success) {
                    localNotify?.warn?.("[App] Chat load failed from navigation for chatId:", { group: true, context: 'app', module: 'App', chatId });
                }
            }
        } else {
            localNotify?.debug?.('[App] Navigating to project list view.', { context: 'app', module: 'App', source: 'handleNavigationChange' });
            await projectDashboard.showProjectList();
        }
    } catch (navError) {
        localNotify?.error?.('[App] Error during navigation handling logic.', { group: true, context: 'app', module: 'App', source: 'handleNavigationChange', error: navError });
        projectDashboard.showProjectList?.().catch(fbErr => {
            localNotify?.error?.('[App] Fallback to showProjectList also failed.', { group: true, context: 'app', module: 'App', error: fbErr });
        });
    }
}

// Internal flags for AuthBus listeners to prevent duplicates
let _authStateChangedAttached = false;
let _chatInitAuthAttached = false;

function attachAuthBusListener(event, handler, markerFlagName) {
    const localNotify = DependencySystem.modules.get('notify');
    const auth = DependencySystem.modules.get('auth');
    const bus = auth?.AuthBus;

    if (!bus || typeof eventHandlers.trackListener !== "function") {
        localNotify?.error?.('[App] Cannot attach AuthBus listener: AuthBus or eventHandlers.trackListener missing.', { group: true, context: 'app', module: 'App', source: 'attachAuthBusListener' });
        return false;
    }

    let alreadyAttached = false;
    if (markerFlagName === '_globalAuthStateChangedAttached') alreadyAttached = _authStateChangedAttached;
    else if (markerFlagName === '_globalChatInitAuthAttached') alreadyAttached = _chatInitAuthAttached;

    if (alreadyAttached) {
        localNotify?.debug?.(`[App] AuthBus listener for ${event} (${markerFlagName}) already attached. Skipping.`, { context: 'app', module: 'App', source: 'attachAuthBusListener' });
        return false;
    }

    eventHandlers.trackListener(bus, event, handler,
        { description: `[App] AuthBus ${event} (${markerFlagName})`, module: 'App', context: 'authEvents' }
    );

    if (markerFlagName === '_globalAuthStateChangedAttached') _authStateChangedAttached = true;
    else if (markerFlagName === '_globalChatInitAuthAttached') _chatInitAuthAttached = true;

    localNotify?.debug?.(`[App] Attached ${event} listener to AuthBus (${markerFlagName}).`, { context: 'app', module: 'App', source: 'attachAuthBusListener' });
    return true;
}


function handleAuthStateChange(event) {
    const localNotify = DependencySystem.modules.get('notify');
    const { authenticated, user } = event?.detail || {}; // Assuming event.detail has user info
    const newAuthState = !!authenticated;

    if (newAuthState === appState.isAuthenticated) return false; // No actual change

    const previousAuthState = appState.isAuthenticated;
    appState.isAuthenticated = newAuthState;
    if (user) currentUser = user; // Update currentUser if provided by the event

    localNotify?.info?.(`[App] Auth state changed. Authenticated: ${appState.isAuthenticated}`, { context: 'app', module: 'App', source: 'handleAuthStateChange', user: currentUser?.username });

    renderAuthHeader(); // Update UI immediately

    // Asynchronously update other parts of the UI and data
    (async () => {
        try {
            const [pm, pd, sb, cm, st] = await waitFor([
                'projectManager', 'projectDashboard', 'sidebar', 'chatManager', 'storage'
            ], null, APP_CONFIG.TIMEOUTS.DEPENDENCY_WAIT);

            if (appState.isAuthenticated && !previousAuthState) { // User logged in
                localNotify?.debug?.('[App] User logged IN. Refreshing data/UI.', { context: 'app', module: 'App', source: 'handleAuthStateChange' });
                globalUtils.toggleElement(APP_CONFIG.SELECTORS.LOGIN_REQUIRED_MESSAGE, false);
                pd.showProjectList?.();
                const projects = await pm.loadProjects?.('all');
                if (projects) sb.renderProjects?.(projects);
                // Potentially re-initialize chat if a project is active or trigger navigation
                handleNavigationChange();

            } else if (!appState.isAuthenticated && previousAuthState) { // User logged out
                localNotify?.debug?.('[App] User logged OUT. Clearing data/UI.', { context: 'app', module: 'App', source: 'handleAuthStateChange' });
                globalUtils.toggleElement(APP_CONFIG.SELECTORS.LOGIN_REQUIRED_MESSAGE, true);
                pm.currentProject = null;
                st.removeItem('selectedProjectId'); // Use storage service
                pd.showLoginRequiredMessage?.();
                sb.clear?.();
                cm.clear?.();
                lastHandledProj = null; // Reset navigation cache
                lastHandledChat = null;
                handleNavigationChange(); // Navigate to appropriate view (e.g., login or public list)
            }
        } catch (err) {
            localNotify?.error?.('[App] Error updating UI/data after auth state change.', { group: true, context: 'app', module: 'App', source: 'handleAuthStateChange', error: err });
        }
    })();
    return false; // Typically event handlers return false or void
}

function handleInitError(error) {
    appState.initialized = false;
    appState.initializing = false;
    appState.currentPhase = 'failed_init';

    // Defensive accessor so this handler never throws even if DependencySystem
    // or its module map is undefined during early-stage failures.
    const safeGetModule = (name) => {
        try {
            return (DependencySystem && DependencySystem.modules && typeof DependencySystem.modules.get === 'function')
                ? DependencySystem.modules.get(name)
                : undefined;
        } catch {
            return undefined;
        }
    };

    const errorReporter = safeGetModule('errorReporter');
    errorReporter?.capture?.(error, {
        tags: { module: 'app', method: 'init', phase: appState.currentPhase || 'unknown' }
    });

    const localNotify = safeGetModule('notify') || notificationPlaceholder;
    const errorMsgString = error?.message || (typeof error === "string" ? error : "Unknown initialization error.");
    localNotify?.error?.(`Application failed to start: ${errorMsgString}. Please refresh.`, {
        group: true, context: "app", module: "App", source: "handleInitError", timeout: 0 // Keep error visible
    });

    const errorContainer = domAPI.querySelector(APP_CONFIG.SELECTORS.APP_FATAL_ERROR);
    if (errorContainer) {
        domAPI.setTextContent(errorContainer, `Application Error: ${errorMsgString}. Please refresh or contact support.`);
        domAPI.removeClass(errorContainer, 'hidden'); // Ensure it's visible
    }
    globalUtils.toggleElement(APP_CONFIG.SELECTORS.APP_LOADING_SPINNER, false);
}


// Make init globally available or trigger it appropriately
// (e.g., on DOMContentLoaded or if this script is loaded defer/async)
if (typeof window !== 'undefined') {
    window.initializeApp = init; // For explicit call or debugging
    // Automatically initialize if appropriate
    if (document.readyState === 'loading') {
        domAPI.addEventListener(document, 'DOMContentLoaded', init);
    } else {
        init(); // Call immediately if DOM is already ready
    }
}

// Export a limited API if this were a module, e.g.:
// export { init, getAppState };
