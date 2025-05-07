const DEBUG_INIT = true; // Change to true if you want to enable debug logs.
if (typeof window !== 'undefined') window.DEBUG_INIT = DEBUG_INIT;

/****************************************
 * FIX 1: Provide a definition for executeWithTimeout()
 *        This function will wrap a promise-based async task
 *        with a timeout controller.
 ****************************************/
function executeWithTimeout(asyncFn, timeout = 10000, errorMessage = 'Operation timed out') {
  return new Promise((resolve, reject) => {
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      reject(new Error(errorMessage));
    }, timeout);

    asyncFn()
      .then((res) => {
        if (!timedOut) {
          clearTimeout(timer);
          resolve(res);
        }
      })
      .catch((err) => {
        if (!timedOut) {
          clearTimeout(timer);
          reject(err);
        }
      });
  });
}

import { APP_CONFIG } from './appConfig.js';
import { createSentryManager } from './sentry-init.js';
import DOMPurify from './vendor/dompurify.es.js';

const sentryConfig = {
    dsn: 'https://b03711f63d1160f48dcaeda3edae14ac@o4508070823395328.ingest.us.sentry.io/4509138383863808',
    environment: 'production',
    release: 'frontend-app@1.0.0',
    sampleRates: { traces: 1.0, replaysSession: 0.0, replaysOnError: 1.0 }
};
const sentryEnv = {};

import { createDomAPI } from './utils/domAPI.js';
const domAPI = createDomAPI({ documentObject: document, windowObject: window });
const storage = window.localStorage;
const notificationPlaceholder = { log() {}, warn() {}, error() {} };
const sentryNamespace = typeof window !== 'undefined' && window.Sentry ? window : { Sentry: undefined };

let notify = null;
let apiRequest = null;
let currentUser = null;
const appState = {
    initialized: false,
    initializing: false,
    isAuthenticated: false,
    currentPhase: 'idle'
};

// Global init flags:
var _globalInitCompleted = false;
var _globalInitInProgress = false;

/****************************************
 * FIX 3: Add a simple guard to ensure document.addEventListener('locationchange', ...)
 *        is attached only once.
 ****************************************/
let _locationChangeListenerAttached = false;

import * as globalUtils from './utils/globalUtils.js';
import { createBrowserService } from './utils/browserService.js';

// Create browser API and ensure DependencySystem is properly initialized
const browserAPI = globalUtils.createBrowserAPI();
let DependencySystem = null;

// Define a robust fallback DependencySystem factory
function createFallbackDependencySystem() {
    console.warn('[App] Creating a fallback DependencySystem');

    // Create a basic but robust implementation
    const fallbackSystem = {
        modules: new Map(),
        states: new Map(),
        waiters: new Map(),

        register(name, instance) {
            console.log(`[FallbackDependencySystem] Registering ${name}`);
            this.modules.set(name, instance);
            return instance;
        },

        waitFor(names, callback, timeout = 5000) {
            const nameArray = Array.isArray(names) ? names : [names];
            return new Promise((resolve) => {
                // Fast path: check if all dependencies are already available
                const checkAndResolve = () => {
                    try {
                        if (!this.modules || typeof this.modules.has !== 'function') {
                            console.error('[FallbackDependencySystem] modules Map is invalid');
                            return false;
                        }

                        const modulesReady = nameArray.every(name => this.modules.has(name));
                        if (modulesReady) {
                            const modules = nameArray.map(name => this.modules.get(name));
                            if (callback) callback(...modules);
                            resolve(modules);
                            return true;
                        }
                        return false;
                    } catch (err) {
                        console.error('[FallbackDependencySystem] Error in checkAndResolve:', err);
                        return false;
                    }
                };

                if (checkAndResolve()) return;

                // Otherwise poll until dependencies are ready or timeout
                const intervalId = setInterval(() => {
                    try {
                        if (checkAndResolve()) {
                            clearInterval(intervalId);
                            clearTimeout(timeoutId);
                        }
                    } catch (err) {
                        console.error('[FallbackDependencySystem] Error in interval checker:', err);
                    }
                }, 100);

                const timeoutId = setTimeout(() => {
                    clearInterval(intervalId);
                    console.warn(`[FallbackDependencySystem] Timeout waiting for: ${nameArray.join(', ')}`);
                    try {
                        const availableModules = nameArray.map(name =>
                            this.modules && typeof this.modules.get === 'function'
                                ? this.modules.get(name)
                                : null
                        );
                        resolve(availableModules);
                    } catch (err) {
                        console.error('[FallbackDependencySystem] Error in timeout handler:', err);
                        resolve(nameArray.map(() => null));
                    }
                }, timeout);
            });
        },

        getCurrentTraceIds() {
            return { traceId: `fallback-${Date.now()}` };
        },

        generateTransactionId() {
            return `fallback-tx-${Math.random().toString(36).substring(2, 9)}`;
        }
    };

    return fallbackSystem;
}

try {
    // Get DependencySystem from the window object (should be initialized in HTML)
    DependencySystem = browserAPI.getDependencySystem();

    // Verify it has the expected structure
    if (!DependencySystem) {
        console.error('[App] DependencySystem was not found on window object');
        throw new Error('DependencySystem was not found on window object');
    }

    if (!DependencySystem.modules || typeof DependencySystem.modules.get !== 'function') {
        console.error('[App] DependencySystem.modules is missing or not a Map');
        throw new Error('DependencySystem.modules is missing or not a Map');
    }

    console.log('[App] DependencySystem initialized successfully', {
        hasModules: !!DependencySystem.modules,
        modulesType: typeof DependencySystem.modules,
        isDependencySystemMap: DependencySystem.modules instanceof Map,
        registeredModules: DependencySystem.modules.size
    });
} catch (dsError) {
    // Log detailed error and attempt recovery
    console.error('[App] Failed to initialize DependencySystem:', dsError);
    console.warn('[App] Attempting to initialize a fallback DependencySystem...');

    // Create a fallback instance
    const fallbackSystem = createFallbackDependencySystem();

    // Assign it to both our local variable and window.DependencySystem
    DependencySystem = fallbackSystem;
    window.DependencySystem = fallbackSystem;

    console.log('[App] Fallback DependencySystem created and installed');
}

/**
 * Safe module getter with context-aware error notification.
 * @param {string} key - Module key to retrieve.
 * @param {object} contextInfo - { context, module, source }
 * @returns {*} - The requested module, or throws if unavailable.
 */
function getModuleSafe(key, contextInfo = {}) {
    // Verify DependencySystem exists
    if (typeof DependencySystem === 'undefined' || DependencySystem === null) {
        const errorMsg = `[App] DependencySystem is ${typeof DependencySystem === 'undefined' ? 'undefined' : 'null'} when attempting to get ${key}`;
        console.error(errorMsg);

        // Try to create a fallback system if possible
        if (typeof createFallbackDependencySystem === 'function') {
            console.warn(`[App] Attempting to create emergency fallback DependencySystem for ${key}`);
            try {
                DependencySystem = window.DependencySystem = createFallbackDependencySystem();
            } catch (fallbackErr) {
                console.error('[App] Emergency fallback DependencySystem creation failed:', fallbackErr);
            }
        }

        // If we still don't have a valid DependencySystem, throw
        if (typeof DependencySystem === 'undefined' || DependencySystem === null) {
            if (notify) {
                notify.error?.(errorMsg, {
                    group: true,
                    ...contextInfo
                });
            }
            throw new Error(errorMsg);
        }
    }

    // Verify modules property exists
    if (!DependencySystem.modules) {
        const errorMsg = `[App] DependencySystem.modules is undefined when attempting to get ${key}`;
        console.error(errorMsg);

        // Attempt to initialize modules if missing
        try {
            DependencySystem.modules = new Map();
            console.warn('[App] Created new modules Map for DependencySystem');
        } catch (mapErr) {
            console.error('[App] Failed to create modules Map:', mapErr);
        }

        // If still no modules map, throw
        if (!DependencySystem.modules) {
            if (notify) {
                notify.error?.(errorMsg, {
                    group: true,
                    ...contextInfo,
                    traceId: DependencySystem?.getCurrentTraceIds?.()?.traceId,
                    transactionId: DependencySystem?.generateTransactionId?.()
                });
            }
            throw new Error(errorMsg);
        }
    }

    // Verify modules.get is a function
    if (typeof DependencySystem.modules.get !== 'function') {
        const errorMsg = `[App] DependencySystem.modules.get is not a function when attempting to get ${key}`;
        console.error(errorMsg, {
            modulesType: typeof DependencySystem.modules,
            isMap: DependencySystem.modules instanceof Map,
            objectKeys: Object.keys(DependencySystem.modules)
        });

        // Attempt to fix modules if it's not a proper Map
        try {
            if (!(DependencySystem.modules instanceof Map)) {
                const oldModules = DependencySystem.modules;
                DependencySystem.modules = new Map();
                // Copy any entries if oldModules was an object with entries
                if (oldModules && typeof oldModules === 'object') {
                    Object.entries(oldModules).forEach(([k, v]) => {
                        if (k && v) DependencySystem.modules.set(k, v);
                    });
                }
                console.warn('[App] Replaced DependencySystem.modules with proper Map');
            }
        } catch (fixErr) {
            console.error('[App] Failed to fix modules Map:', fixErr);
        }

        // If still no get method, throw
        if (typeof DependencySystem.modules.get !== 'function') {
            if (notify) {
                notify.error?.(errorMsg, {
                    group: true,
                    ...contextInfo,
                    moduleType: typeof DependencySystem.modules
                });
            }
            throw new Error(errorMsg);
        }
    }

    // Return the module (which may be undefined if not registered)
    return DependencySystem.modules.get(key);
}

if (!DependencySystem) {
    domAPI.setInnerHTML(document.body, `
    <div style="padding: 2em; text-align: center; color: red; font-family: sans-serif;">
      <strong>Application Critical Error:</strong> Core dependency system failed to load.<br>
      Please contact support or refresh.
    </div>`);
    throw new Error("DependencySystem is required but not available.");
}

DependencySystem.register('domAPI', domAPI);
DependencySystem.register('browserAPI', browserAPI);
const browserServiceInstance = createBrowserService({ windowObject: window, domAPI });
DependencySystem.register('browserService', browserServiceInstance);
DependencySystem.register('storage', browserServiceInstance);

let sanitizerInstance;
try {
  sanitizerInstance = (typeof DOMPurify === 'function') ? DOMPurify(window) : DOMPurify;
} catch (err) {
  console.warn('[App] Error initializing DOMPurify, falling back to default export:', err);
  sanitizerInstance = DOMPurify;
}
DependencySystem.register('sanitizer', sanitizerInstance);

const defaultApiEndpoints = {
  AUTH_CSRF: '/api/auth/csrf',
  AUTH_LOGIN: '/api/auth/login',
  AUTH_REGISTER: '/api/auth/register',
  AUTH_LOGOUT: '/api/auth/logout',
  AUTH_REFRESH: '/api/auth/refresh',
  AUTH_VERIFY: '/api/auth/verify',
  PROJECTS: '/api/projects/',
  DETAIL: (id) => `/api/projects/${id}/`,
  STATS: (id) => `/api/projects/${id}/stats/`,
  FILES: (id) => `/api/projects/${id}/files/`,
  ARTIFACTS: (id) => `/api/projects/${id}/artifacts/`,
  KB: (id) => `/api/projects/${id}/knowledge_base/`,
  ARCHIVE: (id) => `/api/projects/${id}/archive/`,
  CONVERSATIONS: (projectId) => `/api/projects/${projectId}/conversations/`,
  CONVERSATION: (projectId, convId) => `/api/projects/${projectId}/conversations/${convId}`,
  MESSAGES: (projectId, convId) => `/api/projects/${projectId}/conversations/${convId}/messages`
};

const apiEndpoints = {
  ...defaultApiEndpoints,
  ...(APP_CONFIG?.API_ENDPOINTS || {})
};
DependencySystem.register('apiEndpoints', apiEndpoints);
const waitFor = DependencySystem.waitFor.bind(DependencySystem);

const sentryManager = createSentryManager({
    config: sentryConfig,
    env: sentryEnv,
    domAPI,
    storage,
    notification: notificationPlaceholder,
    navigator: window.navigator,
    window,
    document,
    sentryNamespace
});
sentryManager.initialize();
DependencySystem.register('sentryManager', sentryManager);
DependencySystem.register('errorReporter', sentryManager);

import { createEventHandlers } from './eventHandler.js';
import { createNotificationHandler } from './notification-handler.js';
import { createNotify } from './utils/notify.js';

const preliminaryNotifyForEventHandlers = {
    debug: (...args) => console.debug('[EH Prelim Notify]', ...args),
    info: (...args) => console.info('[EH Prelim Notify]', ...args),
    warn: (...args) => console.warn('[EH Prelim Notify]', ...args),
    error: (...args) => console.error('[EH Prelim Notify]', ...args),
    success: (...args) => console.info('[EH Prelim Notify]', ...args)
};

// First verify DependencySystem is properly initialized before creating eventHandlers
if (!DependencySystem || !DependencySystem.modules || typeof DependencySystem.modules.get !== 'function') {
    console.error('[App] DependencySystem not properly initialized before creating eventHandlers');
    throw new Error('[App] DependencySystem not properly initialized before creating eventHandlers');
}

// Create eventHandlers but wait to initialize until later
const eventHandlers = createEventHandlers({
    DependencySystem,
    domAPI,
    browserService: browserServiceInstance,
    notify: preliminaryNotifyForEventHandlers
});
// Register eventHandlers without initializing it yet
DependencySystem.register('eventHandlers', eventHandlers);

// NOTE: eventHandlers.init() will be called later during the initialization phase
// Do not call it here to avoid dependency issues

const notificationHandler = createNotificationHandler({
    eventHandlers,
    DependencySystem,
    domAPI,
    groupWindowMs: 7000
});
DependencySystem.register('notificationHandler', notificationHandler);
notify = createNotify({ notificationHandler, sentry: sentryManager, DependencySystem });
DependencySystem.register('notify', notify);

import { createChatManager } from './chat.js';
import { createAuthModule } from './auth.js';
import { createProjectManager } from './projectManager.js';
import { createProjectModal, createModalManager } from './modalManager.js';
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

const app = {
    getProjectId: () => {
        const params = new URLSearchParams(browserAPI.getLocation().search);
        return params.get('project');
    },
    navigateToConversation: async (chatId) => {
        const chatMgr = getModuleSafe('chatManager', { context: 'app', module: 'App', source: 'navigateToConversation' });
        if (chatMgr && typeof chatMgr.loadConversation === 'function') {
            return chatMgr.loadConversation(chatId);
        }
        notify?.warn?.('[App] ChatManager not available for navigateToConversation');
        return false;
    },
    validateUUID: globalUtils.isValidProjectId
};
DependencySystem.register('app', app);

/****************************************
 * init() - Orchestrates the entire initialization lifecycle
 * FIX 5: Keep everything in one place but ensure we unify eventHandlers.init()
 *        to avoid double-calling. Also ensure that locationchange is attached once.
 ****************************************/
async function init() {
    const _initStart = performance.now();

    if (_globalInitCompleted || _globalInitInProgress) {
        notify?.warn?.('[App] Duplicate initialization attempt blocked by global guard.', {
            group: true,
            context: 'app',
            module: 'App',
            source: 'init',
            phase: 'guard',
            globalInitCompleted: _globalInitCompleted,
            globalInitInProgress: _globalInitInProgress
        });
        return _globalInitCompleted;
    }
    if (appState.initialized || appState.initializing) {
        notify?.info?.('[App] Initialization attempt skipped (already done or in progress).', {
            group: true,
            context: 'app',
            module: 'App',
            source: 'init',
            phase: 'guard',
            appStateInitialized: appState.initialized,
            appStateInitializing: appState.initializing
        });
        return appState.initialized;
    }

    _globalInitInProgress = true;
    appState.initializing = true;
    appState.currentPhase = 'starting_init_process';
    notify?.debug?.('[App] START init function', { context: 'app', module: 'App', source: 'init', phase: appState.currentPhase });

    // Create API Client
    notify?.debug?.('[App] Creating API Client...', { context: 'app', module: 'App', source: 'init' });
    apiRequest = globalUtils.createApiClient({
        APP_CONFIG,
        globalUtils,
        notificationHandler: notify,
        getAuthModule: () => getModuleSafe('auth', { context: 'app', module: 'App', source: 'getAuthModule' }),
        browserAPI
    });
    DependencySystem.register('apiRequest', apiRequest);
    app.apiRequest = apiRequest;
    notify?.debug?.('[App] API Client CREATED.', { context: 'app', module: 'App', source: 'init' });

    // Create Chat Manager
    notify?.debug?.('[App] Creating Chat Manager...', { context: 'app', module: 'App', source: 'init' });
    if (!DependencySystem || !DependencySystem.modules) {
        notify?.error?.('[App] DependencySystem or DependencySystem.modules is undefined before accessing browserAPI', {
            group: true,
            context: 'app',
            module: 'App',
            source: 'init',
            traceId: DependencySystem?.getCurrentTraceIds?.().traceId,
            transactionId: DependencySystem?.generateTransactionId?.()
        });
        throw new Error('[App] DependencySystem or DependencySystem.modules is undefined before accessing browserAPI');
    }
    const chatBrowserAPI = getModuleSafe('browserAPI', { context: 'app', module: 'App', source: 'chatBrowserAPI' });
    const chatManager = createChatManager({
        DependencySystem,
        apiRequest,
        auth: () => getModuleSafe('auth', { context: 'app', module: 'App', source: 'authInjection' }),
        eventHandlers,
        app,
        domAPI,
        navAPI: {
            getSearch: () => chatBrowserAPI.getLocation().search,
            getHref: () => chatBrowserAPI.getLocation().href,
            pushState: (url, title = '') => chatBrowserAPI.getHistory().pushState({}, title, url),
            getPathname: () => chatBrowserAPI.getLocation().pathname
        },
        isValidProjectId: globalUtils.isValidProjectId,
        isAuthenticated: () => {
            const authModule = getModuleSafe('auth', { context: 'app', module: 'App', source: 'isAuthenticated' });
            return typeof authModule?.isAuthenticated === 'function' ? authModule.isAuthenticated() : false;
        },
        DOMPurify: getModuleSafe('sanitizer', { context: 'app', module: 'App', source: 'chatManager' }),
        apiEndpoints: getModuleSafe('apiEndpoints', { context: 'app', module: 'App', source: 'chatManager' }),
        notificationHandler: notify
    });
    if (!chatManager || typeof chatManager.initialize !== 'function') {
        notify?.error?.('[App] createChatManager() did not return a valid ChatManager instance.', { group: true });
        throw new Error('[App] createChatManager() failed.');
    }
    DependencySystem.register('chatManager', chatManager);
    notify?.debug?.('[App] Chat Manager CREATED and registered.', { context: 'app', module: 'App', source: 'init' });

    // Ensure locationchange is tracked exactly once.
    if (!_locationChangeListenerAttached) {
        document.addEventListener('locationchange', function () {
            const container = notify.getContainer?.() || domAPI.getElementById('notificationArea');
            if (container) {
                notify.clearNonSticky?.();
            }
        });
        _locationChangeListenerAttached = true;
    }

    notify?.debug?.('[App] Initializing application core systems and UI...', { context: 'app', module: 'App', source: 'init', phase: 'core_init_start' });
    globalUtils.toggleElement(APP_CONFIG.SELECTORS.APP_LOADING_SPINNER, true);
    const initStartTime = performance.now();

    try {
        // Initialize core systems with a timeout
        appState.currentPhase = 'init_core_systems';
        notify?.debug?.(`[App] Phase: ${appState.currentPhase} - STARTING`, {
        group: true,
        context: 'app',
        module: 'App',
        source: 'init',
        traceId: DependencySystem?.getCurrentTraceIds?.().traceId,
        transactionId: DependencySystem?.generateTransactionId?.()
    });
        await executeWithTimeout(
            () => initializeCoreSystems(),
            APP_CONFIG.TIMEOUTS.PHASE_TIMEOUT || 10000,
            'Core systems initialization timed out'
        );
        if (DEBUG_INIT) console.log(`[DEBUG] Phase ${appState.currentPhase}: Core systems initialized successfully`);

        notify?.debug?.(`[App] Phase "${appState.currentPhase}" completed in ${(performance.now() - initStartTime).toFixed(2)} ms`, {
        group: true,
        context: 'app',
        module: 'App',
        source: 'init',
        traceId: DependencySystem?.getCurrentTraceIds?.().traceId,
        transactionId: DependencySystem?.generateTransactionId?.()
    });

        appState.currentPhase = 'waiting_core_deps';
        notify?.debug?.(`[App] Phase: ${appState.currentPhase}, waiting for DI deps`, {
        group: true,
        context: 'app',
        module: 'App',
        source: 'init',
        traceId: DependencySystem?.getCurrentTraceIds?.().traceId,
        transactionId: DependencySystem?.generateTransactionId?.()
    });
        await waitFor(['auth', 'eventHandlers', 'notificationHandler', 'modalManager'], null, APP_CONFIG.TIMEOUTS.DEPENDENCY_WAIT);
        if (DEBUG_INIT) console.log(`[DEBUG] Phase ${appState.currentPhase}: Core dependencies resolved successfully`);

        // Initialize Auth
        appState.currentPhase = 'init_auth';
        const _authInitStart = performance.now();
        notify?.debug?.(`[App] Phase: ${appState.currentPhase} - STARTING`, {
        group: true,
        context: 'app',
        module: 'App',
        source: 'init',
        traceId: DependencySystem?.getCurrentTraceIds?.().traceId,
        transactionId: DependencySystem?.generateTransactionId?.()
    });
        await initializeAuthSystem();
        notify?.debug?.(`[App] Phase "${appState.currentPhase}" completed in ${(performance.now() - _authInitStart).toFixed(2)} ms`, {
        group: true,
        context: 'app',
        module: 'App',
        source: 'init',
        traceId: DependencySystem?.getCurrentTraceIds?.().traceId,
        transactionId: DependencySystem?.generateTransactionId?.()
    });

        // If authenticated, fetch current user
        if (appState.isAuthenticated) {
            notify?.debug?.(`[App] User is authenticated; fetching current user`, { group: true });
            const _currUserStart = performance.now();
            currentUser = await fetchCurrentUser();
            if (currentUser) {
                browserAPI.setCurrentUser(currentUser);
                DependencySystem.register('currentUser', currentUser);
                notify?.info?.(`[App] Current user loaded`, {
                    group: true, user: currentUser,
                    ms: (performance.now() - _currUserStart).toFixed(2)
                });
            } else {
                notify?.warn?.(`[App] No current user found`, {
                    group: true, ms: (performance.now() - _currUserStart).toFixed(2)
                });
            }
        }

        // Initialize UI
        appState.currentPhase = 'init_ui';
        const _uiStart = performance.now();
        notify?.debug?.(`[App] Phase: ${appState.currentPhase} - STARTING`, {
        group: true,
        context: 'app',
        module: 'App',
        source: 'init',
        traceId: DependencySystem?.getCurrentTraceIds?.().traceId,
        transactionId: DependencySystem?.generateTransactionId?.()
    });
        await initializeUIComponents();
        notify?.debug?.(`[App] Phase "${appState.currentPhase}" completed in ${(performance.now() - _uiStart).toFixed(2)} ms`, { group: true });

        // Finalizing
        appState.currentPhase = 'finalizing';
        notify?.debug?.(`[App] Phase: ${appState.currentPhase} - STARTING sub-tasks`, { group: true });

        // Initialize eventHandlers - critical to do this at the right time
        // when DependencySystem is ready and modules are available
        try {
            // First verify DependencySystem is properly initialized
            if (!DependencySystem || !DependencySystem.modules) {
                notify?.error?.('[App] DependencySystem or DependencySystem.modules is undefined before accessing eventHandlers', {
                    group: true,
                    context: 'app',
                    module: 'App',
                    source: 'eventHandlersInit'
                });
                throw new Error('[App] DependencySystem or DependencySystem.modules is undefined');
            }

            // Get eventHandlers using the safe getter method
            const eh = getModuleSafe('eventHandlers', {
                context: 'app',
                module: 'App',
                source: 'eventHandlersInit'
            });

            // Initialize if available
            if (eh && typeof eh.init === 'function') {
                notify?.debug?.('[App] Initializing eventHandlers', { group: true });
                await eh.init();
                notify?.info?.('[App] EventHandlers initialized successfully', { group: true });
            } else {
                notify?.error?.('[App] eventHandlers.init is not a function or module not found', { group: true });
            }
        } catch (ehErr) {
            notify?.error?.('[App] Error initializing eventHandlers', {
                group: true,
                error: ehErr,
                errorStack: ehErr?.stack
            });
        }

        // modelConfig init
        try {
            const mc = getModuleSafe('modelConfig', { context: 'app', module: 'App', source: 'modelConfigInit' });
            if (mc && typeof mc.initializeUI === 'function') {
                mc.initializeUI();
                notify?.debug?.('[App] modelConfig UI initialized.');
            }
        } catch (mcErr) {
            notify?.warn?.('[App] Error initializing modelConfig UI', { error: mcErr });
        }

        // Register global listeners (moved here after all core modules are registered)
        appState.currentPhase = 'registering_listeners';
        const _listenersStart = performance.now();
        notify?.debug?.(`[App] Phase: ${appState.currentPhase} - STARTING`, { group: true });
        registerAppListeners();
        notify?.debug?.(`[App] Phase "${appState.currentPhase}" completed in ${(performance.now() - _listenersStart).toFixed(2)} ms`, { group: true });

        notify?.debug?.('[App] Calling handleNavigationChange() during finalization', { group: true });
        handleNavigationChange();

        // Mark init as completed
        appState.initialized = true;
        const initEndTime = performance.now();
        const totalMs = initEndTime - initStartTime;
        notify?.info?.(
            `[App] Initialization complete in ${totalMs.toFixed(2)} ms.`,
            { group: true, ms: totalMs, authenticated: appState.isAuthenticated }
        );
        if (totalMs > (APP_CONFIG.PERFORMANCE_THRESHOLDS?.INIT_WARN || 3000)) {
            notify?.warn?.(`[App] Initialization exceeded perf warning threshold: ${totalMs.toFixed(1)} ms`, { group: true });
        }

        _globalInitCompleted = true;
        domAPI.dispatchEvent(document, new CustomEvent('appInitialized', { detail: { success: true } }));
        return true;

    } catch (err) {
        const errorPhase = appState.currentPhase || 'unknown';
        const errorMessage = `[App] Initialization failed in phase '${errorPhase}': ${err?.message || String(err)}`;
        if (DEBUG_INIT) {
            console.error('[App Debug] Initialization failed:', {
                phase: errorPhase,
                error: err,
                appState: { ...appState },
                stack: err?.stack
            });
        }
        notify?.error?.(errorMessage, {
            group: true,
            context: 'app',
            module: 'App',
            source: 'init',
            traceId: DependencySystem?.getCurrentTraceIds?.().traceId,
            transactionId: DependencySystem?.generateTransactionId?.(),
            error: err,
            phase: errorPhase,
            errorStack: err?.stack
        });
        handleInitError(err);
        domAPI.dispatchEvent(document, new CustomEvent('appInitialized', { detail: { success: false, error: err } }));
        return false;
    } finally {
        const totalFinalMs = performance.now() - _initStart;
        notify?.debug?.(`[App] init() finally block. Total execution: ${totalFinalMs.toFixed(1)} ms. Hiding spinner.`, {
            group: true,
            context: 'app',
            module: 'App',
            source: 'init',
            traceId: DependencySystem?.getCurrentTraceIds?.().traceId,
            transactionId: DependencySystem?.generateTransactionId?.()
        });
        _globalInitInProgress = false;
        appState.initializing = false;
        globalUtils.toggleElement(APP_CONFIG.SELECTORS.APP_LOADING_SPINNER, false);
        appState.currentPhase = appState.initialized ? 'initialized_idle' : 'failed_idle';
    }
}

async function initializeCoreSystems() {
    notify?.debug?.('[App] Initializing core systems...', {
        context: 'app',
        module: 'App',
        source: 'initializeCoreSystems',
        traceId: DependencySystem?.getCurrentTraceIds?.().traceId,
        transactionId: DependencySystem?.generateTransactionId?.()
    });
    if (document.readyState !== 'complete' && document.readyState !== 'interactive') {
        await new Promise(resolve => {
            domAPI.addEventListener(document, 'DOMContentLoaded', resolve, { once: true });
        });
    }
    notify?.getContainer?.();

    const modalManager = createModalManager({
        domAPI,
        browserService: browserServiceInstance,
        eventHandlers,
        DependencySystem,
        modalMapping: MODAL_MAPPINGS,
        notify
    });
    DependencySystem.register('modalManager', modalManager);
    window.modalManager = modalManager;

    const authModule = createAuthModule({
        apiRequest,
        notify,
        eventHandlers,
        domAPI,
        sanitizer: getModuleSafe('sanitizer', { context: 'app', module: 'App', source: 'createAuthModule' }),
        modalManager,
        apiEndpoints: getModuleSafe('apiEndpoints', { context: 'app', module: 'App', source: 'createAuthModule' })
    });
    DependencySystem.register('auth', authModule);

    const projectManager = createProjectManager({
        DependencySystem,
        chatManager: () => getModuleSafe('chatManager', { context: 'app', module: 'App', source: 'createProjectManager' }),
        app,
        notify,
        apiEndpoints: getModuleSafe('apiEndpoints', { context: 'app', module: 'App', source: 'createProjectManager' }),
        storage: getModuleSafe('storage', { context: 'app', module: 'App', source: 'createProjectManager' }),
        listenerTracker: {
            add: (target, event, handler, description) =>
                eventHandlers.trackListener(target, event, handler, {
                    description: description || `[ProjectManager] ${event} on ${target?.id || target}`,
                    module: 'ProjectManager',
                    context: 'projectManagerEvents'
                }),
            remove: (target, event, handler) => eventHandlers.cleanupListeners({
                targetElement: target,
                targetType: event,
                targetHandler: handler,
                context: 'projectManagerEvents'
            })
        }
    });
    DependencySystem.register('projectManager', projectManager);

    const projectModal = createProjectModal({
        DependencySystem,
        eventHandlers,
        notify,
        domAPI,
        browserService: browserServiceInstance
    });
    DependencySystem.register('projectModal', projectModal);

    // Wait for modalsLoaded event
    const modalsReadyPromise = new Promise((resolve) => {
        const initialTimeout = setTimeout(() => {
            notify?.warn?.('[App] Modal HTML loading taking >5s.');
        }, 5000);

        const hardTimeout = setTimeout(() => {
            notify?.error?.('[App] TIMEOUT: Modal HTML failed to load/signal in 15s.');
            resolve(false);
        }, 15000);

        const modalsLoadedHandler = (event) => {
            clearTimeout(initialTimeout);
            clearTimeout(hardTimeout);
            notify?.debug?.('[App] Received modalsLoaded event.', {
                context: 'app',
                module: 'App',
                source: 'modalsLoadedHandler',
                traceId: DependencySystem?.getCurrentTraceIds?.().traceId,
                transactionId: DependencySystem?.generateTransactionId?.(),
                detail: event?.detail
            });
            resolve(true);
        };
        eventHandlers.trackListener(document, 'modalsLoaded', modalsLoadedHandler, {
            once: true,
            description: '[App] Modal HTML loader handler',
            context: 'appInit',
            module: 'App'
        });
    });
    const modalsLoaded = await modalsReadyPromise;
    if (!modalsLoaded) {
        notify?.error?.('[App] Modal loading signal not received or timed out. UI may be incomplete.', { group: true });
    } else {
        const projectForm = domAPI.getElementById('projectModalForm');
        if (projectForm) {
            const pmInstance = getModuleSafe('projectModal', { context: 'app', module: 'App', source: 'projectModalForm' });
            if (pmInstance && typeof pmInstance.initForm === 'function') {
                pmInstance.initForm();
            } else {
                // fallback manual listener
                eventHandlers.trackListener(projectForm, 'submit', async (e) => {
                    domAPI.preventDefault(e);
                    const formData = new FormData(projectForm);
                    const data = Object.fromEntries(formData.entries());
                    try {
                        const projMgr = getModuleSafe('projectManager', { context: 'app', module: 'App', source: 'projectModalFormSubmit' });
                        await projMgr.saveProject(data.projectId, data);
                        notify?.success?.('Project saved.', { context: 'projectModal' });
                        getModuleSafe('modalManager', { context: 'app', module: 'App', source: 'projectModalFormSubmit' }).hide('project');
                        projMgr.loadProjects?.('all');
                    } catch (err) {
                        notify?.error?.('Failed to save project.', {
                            group: true,
                            context: 'projectModal',
                            module: 'App',
                            source: 'projectModalFormSubmit',
                            error: err
                        });
                    }
                }, { description: 'Project Modal Form Submit', module: 'App', context: 'projectModal' });
            }
        } else {
            notify?.warn?.('[App] projectModalForm not found after modalsLoaded signal.', {
                group: true,
                context: 'app',
                module: 'App',
                source: 'initializeCoreSystems'
            });
        }
    }

    if (typeof modalManager.init === 'function') {
        modalManager.init();
    }

    // If already authenticated, initialize chat manager
    if (appState.isAuthenticated) {
        const chatMgrInstance = getModuleSafe('chatManager', { context: 'app', module: 'App', source: 'initializeCoreSystems' });
        if (chatMgrInstance && typeof chatMgrInstance.initialize === 'function') {
            notify?.debug?.('[App] Initializing ChatManager (authenticated)...');
            await chatMgrInstance.initialize({ projectId: app.getProjectId() });
        }
    }

    if (typeof projectManager.initialize === 'function') {
        await projectManager.initialize();
    }
    if (typeof projectModal.init === 'function') {
        projectModal.init();
    }
    notify?.debug?.('[App] Core systems initialized.', {
        group: true,
        context: 'app',
        module: 'App',
        source: 'initializeCoreSystems',
        traceId: DependencySystem?.getCurrentTraceIds?.().traceId,
        transactionId: DependencySystem?.generateTransactionId?.()
    });
}

async function initializeAuthSystem() {
    notify?.debug?.('[App] Initializing authentication system...', {
        context: 'app',
        module: 'App',
        source: 'initializeAuthSystem',
        traceId: DependencySystem?.getCurrentTraceIds?.().traceId,
        transactionId: DependencySystem?.generateTransactionId?.()
    });
    const auth = getModuleSafe('auth', { context: 'app', module: 'App', source: 'initializeAuthSystem' });
    if (!auth || typeof auth.init !== 'function') {
        throw new Error("[App] Auth module is missing or invalid.");
    }
    try {
        await auth.init();
        appState.isAuthenticated = auth.isAuthenticated();
        notify?.debug?.(`[App] Initial auth state: ${appState.isAuthenticated}`, {
            context: 'app',
            module: 'App',
            source: 'initializeAuthSystem',
            traceId: DependencySystem?.getCurrentTraceIds?.().traceId,
            transactionId: DependencySystem?.generateTransactionId?.()
        });
        const bus = auth.AuthBus;
        if (bus && typeof eventHandlers.trackListener === 'function') {
            eventHandlers.trackListener(bus, 'authStateChanged', handleAuthStateChange, {
                description: '[App] AuthBus authStateChanged listener',
                module: 'App',
                context: 'authEvents'
            });
        }
        renderAuthHeader();
    } catch (err) {
        appState.isAuthenticated = false;
        notify?.error?.('[App] Auth system initialization failed.', { group: true, error: err });
        throw new Error(`[App] initializeAuthSystem failed: ${err.message}`);
    }
}

let _uiComponentsInitialized = false;
async function initializeUIComponents() {
    if (_uiComponentsInitialized) {
        notify?.warn?.('[App] initializeUIComponents called again, skipping.');
        return;
    }
    notify?.debug?.('[App] Initializing UI components...', { context: 'app', module: 'App', source: 'initializeUIComponents' });
    let projectListView = domAPI.getElementById('projectListView');
    if (!projectListView) {
        projectListView = domAPI.createElement('div');
        domAPI.setAttribute(projectListView, 'id', 'projectListView');
        domAPI.addClass(projectListView, 'w-full');
        domAPI.appendChild(document.body, projectListView);
    }

    // Example code that could fetch partials if needed ...
    // -- omitted for brevity --

    // Register optional modules
    if (FileUploadComponent) {
        DependencySystem.register('FileUploadComponent', FileUploadComponent);
    }
    const chatExtensionsInstance = createChatExtensions({ DependencySystem, eventHandlers, notificationHandler: notify });
    DependencySystem.register('chatExtensions', chatExtensionsInstance);

    const modelConfigInstance = createModelConfig({ DependencySystem, notify });
    DependencySystem.register('modelConfig', modelConfigInstance);

    const projectDashboardUtilsInstance = createProjectDashboardUtils({ DependencySystem });
    DependencySystem.register('projectDashboardUtils', projectDashboardUtilsInstance);

    const projectListComponentInstance = new ProjectListComponent({
        projectManager: () => getModuleSafe('projectManager', { context: 'app', module: 'App', source: 'ProjectListComponent' }),
        eventHandlers,
        modalManager: () => getModuleSafe('modalManager', { context: 'app', module: 'App', source: 'modalManagerInjection' }),
        app,
        router: {
            navigate: (url) => {
                browserAPI.getHistory().pushState({}, '', url);
                domAPI.dispatchEvent(window, new Event('locationchange'));
            },
            getURL: () => browserAPI.getLocation().href
        },
        notify,
        storage: getModuleSafe('storage', { context: 'app', module: 'App', source: 'ProjectListComponent' }),
        sanitizer: getModuleSafe('sanitizer', { context: 'app', module: 'App', source: 'ProjectListComponent' }),
        domAPI
    });
    DependencySystem.register('projectListComponent', projectListComponentInstance);

    const projectDashboardInstance = createProjectDashboard(DependencySystem);
    DependencySystem.register('projectDashboard', projectDashboardInstance);

    const projectDetailsComponentInstance = createProjectDetailsComponent({
        projectManager: () => getModuleSafe('projectManager', { context: 'app', module: 'App', source: 'ProjectDetailsComponent' }),
        eventHandlers,
        modalManager: () => getModuleSafe('modalManager', { context: 'app', module: 'App', source: 'ProjectDetailsComponent' }),
        FileUploadComponentClass: () => getModuleSafe('FileUploadComponent', { context: 'app', module: 'App', source: 'ProjectDetailsComponent' }, false),
        router: {},
        domAPI,
        notify,
        sanitizer: getModuleSafe('sanitizer', { context: 'app', module: 'App', source: 'ProjectDetailsComponent' }),
        app,
        onBack: async () => {
            const pd = await waitFor('projectDashboard');
            pd?.showProjectList?.();
        }
    });
    DependencySystem.register('projectDetailsComponent', projectDetailsComponentInstance);

    const sidebarInstance = createSidebar({
        DependencySystem,
        eventHandlers,
        app,
        projectDashboard: projectDashboardInstance,
        projectManager: () => getModuleSafe('projectManager', { context: 'app', module: 'App', source: 'Sidebar' }),
        notify,
        storageAPI: getModuleSafe('storage', { context: 'app', module: 'App', source: 'storageAPIInjection' }),
        domAPI,
        viewportAPI: { getInnerWidth: () => window.innerWidth }
    });
    DependencySystem.register('sidebar', sidebarInstance);

    DependencySystem.register('utils', globalUtils);

    const knowledgeBaseComponentInstance = createKnowledgeBaseComponent({
        DependencySystem,
        apiRequest,
        auth: () => getModuleSafe('auth', { context: 'app', module: 'App', source: 'KnowledgeBaseComponent' }),
        projectManager: () => getModuleSafe('projectManager', { context: 'app', module: 'App', source: 'KnowledgeBaseComponent' }),
        uiUtils: globalUtils,
        sanitizer: getModuleSafe('sanitizer', { context: 'app', module: 'App', source: 'KnowledgeBaseComponent' })
    });
    DependencySystem.register('knowledgeBaseComponent', knowledgeBaseComponentInstance);

    // Helper to initialize individual components
    async function initializeComponent(instance, name, method = 'init') {
        if (typeof instance?.[method] === 'function') {
            try {
                if (DEBUG_INIT) console.log(`[DEBUG] Initializing UI component: ${name}`);
                await instance[method]();
                if (DEBUG_INIT) console.log(`[DEBUG] Successfully initialized: ${name}`);
            } catch (err) {
                notify?.warn?.(`[App] ${name} initialization failed but continuing`, { error: err });
                if (DEBUG_INIT) console.warn(`[DEBUG] Failed to initialize ${name}:`, err);
            }
        }
    }
    await initializeComponent(sidebarInstance, 'Sidebar', 'init');
    await initializeComponent(chatExtensionsInstance, 'ChatExtensions', 'init');
    await initializeComponent(knowledgeBaseComponentInstance, 'KnowledgeBase', 'initialize');
    await initializeComponent(projectDashboardInstance, 'ProjectDashboard', 'initialize');
    await initializeComponent(projectListComponentInstance, 'ProjectList', 'initialize');
    await initializeComponent(projectDetailsComponentInstance, 'ProjectDetails', 'initialize');

    // Attempt to load projects if authenticated
    if (appState.isAuthenticated) {
        const pm = getModuleSafe('projectManager', { context: 'app', module: 'App', source: 'initializeUIComponents' });
        if (pm?.loadProjects) {
            notify?.debug?.('[App] Loading projects (UI init, authenticated)...', {
        context: 'app',
        module: 'App',
        source: 'initializeUIComponents',
        traceId: DependencySystem?.getCurrentTraceIds?.().traceId,
        transactionId: DependencySystem?.generateTransactionId?.()
    });
            pm.loadProjects('all').catch(err => {
                notify?.error?.('[App] Failed to load projects during UI initialization.', { group: true, error: err });
            });
        }
    } else {
        notify?.warn?.('[App] Not authenticated, skipping initial project load in UI init.', {
            group: true,
            context: 'app',
            module: 'App',
            source: 'initializeUIComponents',
            traceId: DependencySystem?.getCurrentTraceIds?.().traceId,
            transactionId: DependencySystem?.generateTransactionId?.()
        });
    }

    // Optional script calls
    if (typeof window.initAccessibilityEnhancements === 'function') {
        window.initAccessibilityEnhancements({ domAPI, notify });
    }
    if (typeof window.initSidebarEnhancements === 'function') {
        window.initSidebarEnhancements({ domAPI, notify, eventHandlers });
    }

    _uiComponentsInitialized = true;
    notify?.debug?.('[App] UI components initialized.', {
        context: 'app',
        module: 'App',
        source: 'initializeUIComponents',
        traceId: DependencySystem?.getCurrentTraceIds?.().traceId,
        transactionId: DependencySystem?.generateTransactionId?.()
    });
}

function renderAuthHeader() {
    try {
        const authMod = getModuleSafe('auth', { context: 'app', module: 'App', source: 'renderAuthHeader' });
        const isAuth = authMod?.isAuthenticated?.();
        const btn = domAPI.querySelector(APP_CONFIG.SELECTORS.AUTH_BUTTON) || domAPI.getElementById('loginButton');
        if (btn) {
            domAPI.setTextContent(btn, isAuth ? 'Logout' : 'Login');
            eventHandlers.trackListener(btn, 'click', (e) => {
                domAPI.preventDefault(e);
                if (isAuth) authMod.logout();
                else getModuleSafe('modalManager', { context: 'app', module: 'App', source: 'renderAuthHeader' })?.show('login');
            }, { description: '[App] Auth login/logout button', module: 'App', context: 'authHeader' });
        }
        const authStatus = domAPI.querySelector(APP_CONFIG.SELECTORS.AUTH_STATUS_SPAN);
        const userStatus = domAPI.querySelector(APP_CONFIG.SELECTORS.USER_STATUS_SPAN);
        if (authStatus) domAPI.setTextContent(authStatus, isAuth ? 'Signed in' : 'Not signed in');
        if (userStatus) {
            domAPI.setTextContent(userStatus, isAuth && currentUser ? `Hello, ${currentUser.name || currentUser.username}` : '');
        }
    } catch (err) {
        notify?.error?.('[App] Error rendering auth header.', {
            context: 'app',
            module: 'App',
            source: 'renderAuthHeader',
            traceId: DependencySystem?.getCurrentTraceIds?.().traceId,
            transactionId: DependencySystem?.generateTransactionId?.(),
            error: err
        });
    }
}

async function fetchCurrentUser() {
    try {
        const authModule = getModuleSafe('auth', { context: 'app', module: 'App', source: 'fetchCurrentUser' });
        if (authModule?.getCurrentUserAsync) {
            return await authModule.getCurrentUserAsync();
        }
        if (authModule?.getCurrentUser) {
            return authModule.getCurrentUser();
        }
        notify?.warn?.('[App] fetchCurrentUser: No method found on auth module.');
        return null;
    } catch (error) {
        notify?.error?.('[App] Failed to fetch current user', { error });
        return null;
    }
}

function registerAppListeners() {
    notify?.debug?.('[App] Registering global application listeners...');
    waitFor(['auth', 'chatManager', 'projectManager', 'eventHandlers'], () => {
        setupChatInitializationTrigger();
        eventHandlers.trackListener(window, 'locationchange', handleNavigationChange, {
            description: 'Global locationchange event', module: 'App', context: 'navigation'
        });
    }).catch(err => {
        notify?.error?.('[App] Failed to wait for dependencies for global listeners.', { group: true, error: err });
    });
    notify?.debug?.('[App] Global application listeners registered.', {
        group: true,
        context: 'app',
        module: 'App',
        source: 'registerAppListeners'
    });
}

function setupChatInitializationTrigger() {
    const requiredDeps = ['auth', 'chatManager', 'projectManager', 'notify', 'eventHandlers'];
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
                localNotify?.warn?.('[App] Chat init trigger: Missing core dependencies.', { group: true });
                return;
            }
            const currentAppProjectId = app.getProjectId();
            const finalProjectId = forceProjectId ?? currentAppProjectId ?? projMgr.currentProject?.id ?? null;
            if (authMod.isAuthenticated()) {
                if (finalProjectId && globalUtils.isValidProjectId(finalProjectId)) {
                    localNotify?.debug?.(`[App] Debounced chat init: Initializing for project ${finalProjectId}`, { group: true });
                    await chatMgr.initialize({ projectId: finalProjectId });
                } else {
                    localNotify?.debug?.('[App] Debounced chat init: Auth but no valid project ID. Clearing chat.', { group: true });
                    chatMgr.clear?.();
                }
            } else {
                localNotify?.debug?.('[App] Debounced chat init: Not authenticated. Clearing chat.', { group: true });
                chatMgr.clear?.();
            }
        } catch (err) {
            DependencySystem.modules.get('notify')?.error?.(`[App] Error in debounced chat initialization: ${err?.message}`, {
                group: true, error: err
            });
        }
    }, 350);

    waitFor(requiredDeps, (...resolvedDeps) => {
        const [authMod, chatMgr, projMgr, localNotify, localEventHandlers] = resolvedDeps;
        // Diagnostic log for authMod
        console.error('[App] setupChatInitializationTrigger diagnostic:', {
            authMod,
            authModType: typeof authMod,
            authModKeys: authMod ? Object.keys(authMod) : null,
            modulesKeys: DependencySystem.modules ? Array.from(DependencySystem.modules.keys()) : null,
            modulesAuth: getModuleSafe('auth', { context: 'app', module: 'App', source: 'setupChatInitializationTrigger' })
        });
        if (authMod && authMod.AuthBus) {
            attachAuthBusListener('authStateChanged', debouncedInitChat, '_globalChatInitAuthAttached');
        } else {
            getModuleSafe('notify', { context: 'app', module: 'App', source: 'setupChatInitializationTrigger' })?.warn?.('[App] AuthBus not found on auth module.');
        }
        if (!document._chatInitProjListenerAttached) {
            localEventHandlers.trackListener(document, 'currentProjectChanged',
                () => debouncedInitChat(),
                { description: 'Current project changed -> reinit chat', module: 'App', context: 'chatTrigger' }
            );
            document._chatInitProjListenerAttached = true;
        }
        localEventHandlers.trackListener(document, 'currentProjectReady',
            e => debouncedInitChat(e.detail?.project?.id),
            { description: 'Project ready -> reinit chat', module: 'App', context: 'chatTrigger' }
        );

        setTimeout(() => {
            if (authMod?.isAuthenticated?.()) {
                if (DEBUG_INIT) console.log('[DEBUG] Triggering initial chat initialization (authenticated)');
                debouncedInitChat();
            } else if (DEBUG_INIT) {
                console.log('[DEBUG] Skipping initial chat initialization (not authenticated)');
            }
        }, 100);
    }, APP_CONFIG.TIMEOUTS.DEPENDENCY_WAIT * 2)
    .catch(err => {
        DependencySystem.modules.get('notify')?.error?.('[App] Failed setup for chat init triggers.', { group: true, error: err });
    });
}

let lastHandledProj = null;
let lastHandledChat = null;
async function handleNavigationChange() {
    const localNotify = DependencySystem.modules.get('notify');
    if (!appState.initialized) {
        if (appState.initializing) {
            // Wait briefly and re-check
            await new Promise(r => setTimeout(r, 150));
            if (!appState.initialized) {
                localNotify?.warn?.("[App] handleNavigationChange: Aborted, initialization didn't complete in time.");
                return;
            }
        } else {
            localNotify?.warn?.("[App] handleNavigationChange: Aborted, application not initialized.");
            return;
        }
    }
    const currentUrl = browserAPI.getLocation().href;
    localNotify?.debug?.(`[App] Handling navigation change. URL: ${currentUrl}`);

    let projectDashboard;
    try {
        projectDashboard = await waitFor('projectDashboard', null, APP_CONFIG.TIMEOUTS.DEPENDENCY_WAIT);
    } catch (e) {
        localNotify?.error?.('[App] Project Dashboard unavailable for navigation.', { group: true, error: e });
        globalUtils.toggleElement(APP_CONFIG.SELECTORS.APP_FATAL_ERROR, true);
        const errorEl = domAPI.querySelector(APP_CONFIG.SELECTORS.APP_FATAL_ERROR);
        if (errorEl) {
            domAPI.setTextContent(errorEl, 'Core UI component failed to load for navigation. Please refresh.');
        }
        return;
    }

    const url = new URL(currentUrl);
    const projectId = url.searchParams.get('project');
    const chatId = url.searchParams.get('chatId') || null;

    if (projectId === lastHandledProj && chatId === lastHandledChat && appState.initialized) {
        localNotify?.debug?.('[App] Same project/chat; skipping full re-load.');
        return;
    }
    lastHandledProj = projectId;
    lastHandledChat = chatId;

    if (!appState.isAuthenticated) {
        localNotify?.debug?.('[App] Navigation change: User not authenticated. Showing login required.');
        projectDashboard.showLoginRequiredMessage?.();
        return;
    }
    globalUtils.toggleElement(APP_CONFIG.SELECTORS.LOGIN_REQUIRED_MESSAGE, false);

    try {
        const projectManager = await waitFor('projectManager', null, APP_CONFIG.TIMEOUTS.DEPENDENCY_WAIT);
        if (projectId && globalUtils.isValidProjectId(projectId)) {
            localNotify?.debug?.(`[App] Navigating to project details: ${projectId}, chatId=${chatId}`);
            await projectManager.loadProjectDetails(projectId);
            await projectDashboard.showProjectDetails(projectId);

            if (chatId) {
                localNotify?.debug?.(`[App] Attempting to load conversation: ${chatId}`);
                const success = await app.navigateToConversation(chatId);
                if (!success) {
                    localNotify?.warn?.("[App] Chat load failed from navigation for chatId:", {
                        group: true,
                        context: 'app',
                        module: 'App',
                        source: 'handleNavigationChange',
                        chatId
                    });
                }
            }
        } else {
            localNotify?.debug?.('[App] Navigating to project list view.');
            await projectDashboard.showProjectList();
        }
    } catch (navError) {
        localNotify?.error?.('[App] Error during navigation handling logic.', {
            group: true,
            context: 'app',
            module: 'App',
            source: 'handleNavigationChange',
            error: navError
        });
        projectDashboard.showProjectList?.().catch(fbErr => {
            localNotify?.error?.('[App] Fallback to showProjectList also failed.', {
                group: true,
                context: 'app',
                module: 'App',
                source: 'handleNavigationChange',
                error: fbErr
            });
        });
    }
}

// FIX 7+8: AuthBus listeners are attached only once. We guard with special flags.
let _globalAuthStateChangedAttached = false;
let _globalChatInitAuthAttached = false;

function attachAuthBusListener(event, handler, markerFlagName) {
    const localNotify = getModuleSafe('notify', { context: 'app', module: 'App', source: 'attachAuthBusListener' });
    const auth = getModuleSafe('auth', { context: 'app', module: 'App', source: 'attachAuthBusListener' });
    // Diagnostic logging
    console.error('[App] attachAuthBusListener diagnostic:', {
        auth,
        authType: typeof auth,
        authKeys: auth ? Object.keys(auth) : null,
        modulesKeys: DependencySystem.modules ? Array.from(DependencySystem.modules.keys()) : null,
        modulesAuth: getModuleSafe('auth', { context: 'app', module: 'App', source: 'attachAuthBusListener' })
    });
    if (!auth) {
        localNotify?.error?.('[App] attachAuthBusListener: DependencySystem.modules.get("auth") returned undefined.', {
            group: true,
            context: 'app',
            module: 'App',
            source: 'attachAuthBusListener'
        });
        throw new Error('[App] attachAuthBusListener: auth module is undefined.');
    }
    if (!auth.AuthBus || typeof auth.AuthBus.addEventListener !== 'function') {
        localNotify?.error?.('[App] attachAuthBusListener: auth.AuthBus is not an EventTarget.', {
            group: true,
            context: 'app',
            module: 'App',
            source: 'attachAuthBusListener'
        });
        throw new Error('[App] attachAuthBusListener: auth.AuthBus is not an EventTarget.');
    }
    const bus = auth.AuthBus;
    if (!bus || typeof eventHandlers.trackListener !== "function") {
        localNotify?.error?.('[App] Cannot attach AuthBus listener: AuthBus or trackListener missing.');
        return false;
    }

    let alreadyAttached = false;
    if (markerFlagName === '_globalAuthStateChangedAttached') alreadyAttached = _globalAuthStateChangedAttached;
    else if (markerFlagName === '_globalChatInitAuthAttached') alreadyAttached = _globalChatInitAuthAttached;

    if (alreadyAttached) {
        localNotify?.debug?.(`[App] AuthBus listener for ${event} (${markerFlagName}) already attached. Skipping.`);
        return false;
    }

    // Attach the listener to the AuthBus EventTarget, not the auth object itself!
    eventHandlers.trackListener(bus, event, handler, {
        description: `[App] AuthBus ${event} (${markerFlagName})`,
        module: 'App',
        context: 'authEvents'
    });

    if (markerFlagName === '_globalAuthStateChangedAttached') _globalAuthStateChangedAttached = true;
    else if (markerFlagName === '_globalChatInitAuthAttached') _globalChatInitAuthAttached = true;

    localNotify?.debug?.(`[App] Attached ${event} listener to AuthBus (${markerFlagName}).`);
    return true;
}

function handleAuthStateChange(event) {
    const localNotify = getModuleSafe('notify', { context: 'app', module: 'App', source: 'handleAuthStateChange' });
    const { authenticated, user } = event?.detail || {};
    const newAuthState = !!authenticated;

    if (newAuthState === appState.isAuthenticated) {
        return false;
    }
    const previousAuthState = appState.isAuthenticated;
    appState.isAuthenticated = newAuthState;
    if (user) currentUser = user;

    localNotify?.info?.(`[App] Auth state changed. Authenticated: ${appState.isAuthenticated}`, {
        group: true,
        context: 'app',
        module: 'App',
        source: 'handleAuthStateChange',
        user: currentUser?.username
    });
    renderAuthHeader();

    (async () => {
        try {
            const [pm, pd, sb, cm, st] = await waitFor(
                ['projectManager', 'projectDashboard', 'sidebar', 'chatManager', 'storage'],
                null,
                APP_CONFIG.TIMEOUTS.DEPENDENCY_WAIT
            );

            if (appState.isAuthenticated && !previousAuthState) {
                localNotify?.debug?.('[App] User logged IN. Refreshing data/UI.', {
                    group: true,
                    context: 'app',
                    module: 'App',
                    source: 'handleAuthStateChange'
                });
                globalUtils.toggleElement(APP_CONFIG.SELECTORS.LOGIN_REQUIRED_MESSAGE, false);
                pd.showProjectList?.();
                const projects = await pm.loadProjects?.('all');
                if (projects) sb.renderProjects?.(projects);
                handleNavigationChange();

            } else if (!appState.isAuthenticated && previousAuthState) {
                localNotify?.debug?.('[App] User logged OUT. Clearing data/UI.', {
                    group: true,
                    context: 'app',
                    module: 'App',
                    source: 'handleAuthStateChange'
                });
                globalUtils.toggleElement(APP_CONFIG.SELECTORS.LOGIN_REQUIRED_MESSAGE, true);
                pm.currentProject = null;
                st.removeItem('selectedProjectId');
                pd.showLoginRequiredMessage?.();
                sb.clear?.();
                cm.clear?.();
                lastHandledProj = null;
                lastHandledChat = null;
                handleNavigationChange();
            }
        } catch (err) {
            localNotify?.error?.('[App] Error updating UI/data after auth state change.', {
                group: true,
                context: 'app',
                module: 'App',
                source: 'handleAuthStateChange',
                error: err
            });
        }
    })();
    return false;
}

function handleInitError(error) {
    appState.initialized = false;
    appState.initializing = false;
    appState.currentPhase = 'failed_init';

    const errorReporter = getModuleSafe('errorReporter', { context: 'app', module: 'App', source: 'handleInitError' }, false);
    errorReporter?.capture?.(error, {
        tags: { module: 'app', method: 'init', phase: appState.currentPhase || 'unknown' }
    });

    const localNotify = getModuleSafe('notify', { context: 'app', module: 'App', source: 'handleInitError' }, false) || notificationPlaceholder;
    const errorMsgString = error?.message || (typeof error === "string" ? error : "Unknown initialization error.");

    localNotify?.error?.(`Application failed to start: ${errorMsgString}. Please refresh.`, {
        group: true,
        context: "app",
        module: "App",
        source: "handleInitError",
        timeout: 0
    });

    const errorContainer = domAPI.querySelector(APP_CONFIG.SELECTORS.APP_FATAL_ERROR);
    if (errorContainer) {
        domAPI.setTextContent(errorContainer, `Application Error: ${errorMsgString}. Please refresh or contact support.`);
        domAPI.removeClass(errorContainer, 'hidden');
    }
    globalUtils.toggleElement(APP_CONFIG.SELECTORS.APP_LOADING_SPINNER, false);
}

/****************************************
 * If window is available, begin initialization
 ****************************************/
if (typeof window !== 'undefined') {
    // Expose init() globally before any async imports/logic finish.
    window.initializeApp = init;
    if (document.readyState === 'loading') {
        domAPI.addEventListener(document, 'DOMContentLoaded', init);
    } else {
        init();
    }
}
/**
 * All module access must use getModuleSafe('modulename', { context, module, source })
 * This ensures robust, context-rich error handling and eliminates redundant DependencySystem checks.
 */
