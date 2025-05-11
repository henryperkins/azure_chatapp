/**
 * app.js – Main application orchestration.
 * Coordinates module wiring, initialization phases, and DI usage.
 */

import { APP_CONFIG } from './appConfig.js';
import { createDomAPI } from './utils/domAPI.js';             // your abstracted DOM helpers
import { createBrowserService, buildUrl, normaliseUrl } from './utils/browserService.js';
import { createDebugTools } from './utils/notifications-helpers.js';
import { createApiClient } from './utils/apiClient.js';
import { createNotify } from './utils/notify.js';
import { createHtmlTemplateLoader } from './utils/htmlTemplateLoader.js';
import { createSentryManager } from './sentry-init.js';

import {
  shouldSkipDedup,
  stableStringify,
  isAbsoluteUrl,
  isValidProjectId,          // ← nuevo
  toggleElement,
  waitForDepsAndDom                      // ← use global helper for DOM-ready checks
} from './utils/globalUtils.js';

import { safeInvoker, maybeCapture } from './utils/notifications-helpers.js';  // reuse error-wrapped invoker

import { createEventHandlers } from './eventHandler.js';
import { createNotificationHandler } from './notification-handler.js';

import { createAuthModule } from './auth.js';
import { createChatManager } from './chat.js';
import { createProjectManager } from './projectManager.js';
import { createProjectModal, createModalManager } from './modalManager.js';
import { createChatExtensions } from './chatExtensions.js';
import { createModelConfig } from './modelConfig.js';
import { createProjectDashboardUtils } from './projectDashboardUtils.js';
import { ProjectListComponent } from './projectListComponent.js';
import { createProjectDashboard } from './projectDashboard.js';
import { createProjectDetailsComponent } from './projectDetailsComponent.js';
import { createSidebar } from './sidebar.js';
import { createUiRenderer } from './uiRenderer.js'; // Import the new UI Renderer
import { createKnowledgeBaseComponent } from './knowledgeBaseComponent.js';
import { createAccessibilityEnhancements } from './accessibility-utils.js';

import MODAL_MAPPINGS from './modalConstants.js';
import { FileUploadComponent } from './FileUploadComponent.js';
// Removed import for ./auth/authUI.js (now obsolete)

// ---------------------------------------------------------------------------
// UI helpers para KnowledgeBaseComponent (requeridos: formatBytes, formatDate, fileIcon)
// ---------------------------------------------------------------------------
const uiUtils = {
  formatBytes: (b = 0, dp = 1) => {
    if (b === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(b) / Math.log(k));
    return parseFloat((b / Math.pow(k, i)).toFixed(dp)) + ' ' + sizes[i];
  },
  formatDate: (d) => {
    const date = d instanceof Date ? d : new Date(d);
    return isNaN(date) ? '' : date.toLocaleString();
  },
  // Versión mínima: devuelve emoji por tipo o genérico
  fileIcon: (type = '') => {
    const map = { pdf:'📄', doc:'📄', docx:'📄', csv:'🗒️', json:'🗒️', png:'🖼️', jpg:'🖼️', jpeg:'🖼️' };
    return map[(type||'').toLowerCase()] ?? '📄';
  }
};
//DependencySystem.register('uiUtils', uiUtils);

// Back-compat: si la clase aún no define validateUUID, añade alias al helper global
// (Removed: ProjectDetailsComponent is not defined. This block is obsolete.)

// Example: For consistent message durations, etc.

// ---------------------------------------------------------------------------
// 1) Create DI-based references: browserAPI, domAPI, notify, etc.
// ---------------------------------------------------------------------------
const browserServiceInstance = createBrowserService({
    windowObject: (typeof window !== 'undefined') ? window : undefined
});
const browserAPI = browserServiceInstance;   // alias for readability

const domAPI = createDomAPI({
    documentObject: browserAPI.getDocument(),
    windowObject : browserAPI.getWindow(),
    debug        : APP_CONFIG.DEBUG === true
});

// ---------------------------------------------------------------------------
// Provide a temporary no-op notification utility so early-boot code (e.g. Sentry
// manager construction) can safely reference `notify` before the real instance
// is created later in the bootstrap sequence.
//
// It is *re-assigned* once `createNotify()` returns the fully-featured object.
// ---------------------------------------------------------------------------
/**
 * @type {import('./utils/notify.js').Notify|Object<string,Function>}
 * Using a broad type to satisfy IDEs until real notify is assigned.
 */
let notify = Object.assign(
  () => {},                                 // callable noop
  {
    debug   : () => {},
    info    : () => {},
    success : () => {},
    warn    : () => {},
    error   : () => {},
    apiError: () => {},
    authWarn: () => {},
    withContext: () => ({ debug:()=>{}, info:()=>{}, warn:()=>{}, error:()=>{} })
  }
);

const sentryConfig = {
    dsn: 'https://b03711f63d1160f48dcaeda3edae14ac@o4508070823395328.ingest.us.sentry.io/4509138383863808',
    environment: 'production',
    release: 'frontend-app@1.0.0',
    sampleRates: { traces: 1.0, replaysSession: 0.0, replaysOnError: 1.0 }
};

const sentryEnv = {};
const sentryNamespace = browserAPI.getWindow()?.Sentry ? browserAPI.getWindow() : { Sentry: undefined };

// (sentryManager is now constructed only after notify is available; see below)

/*
 * ---------------------------------------------------------------------------
 * 2) Initialize our DependencySystem (if you have a standard approach)
 * ---------------------------------------------------------------------------
 */
const DependencySystem = browserAPI.getDependencySystem();
if (!DependencySystem?.modules?.get) {
    // Hard-fail if not present.
    throw new Error('[App] DependencySystem not present – bootstrap aborted');
}
// Registrar helpers UI una vez disponible DependencySystem
DependencySystem.register('uiUtils', uiUtils);

// Register a few basic items
DependencySystem.register('domAPI', domAPI);
DependencySystem.register('browserAPI', browserAPI);
DependencySystem.register('browserService', browserServiceInstance);
DependencySystem.register('storage', browserServiceInstance);

// Register globalUtils with waitForDepsAndDom for DI (needed by ProjectDashboard)
const globalUtils = {
    waitForDepsAndDom,
    // Optionally, add other helpers if desired, e.g. normaliseUrl, isAbsoluteUrl, etc.
};
DependencySystem.register('globalUtils', globalUtils);

// Register sanitizer (DOMPurify) for DI
const sanitizer = (typeof window !== 'undefined' && window.DOMPurify) ? window.DOMPurify : undefined;
if (!sanitizer) {
    throw new Error('[App] DOMPurify sanitizer not found. Please ensure DOMPurify is loaded before app.js.');
}
DependencySystem.register('sanitizer', sanitizer);
// legacy alias for modules that look for “domPurify”
DependencySystem.register('domPurify', sanitizer);

// Register apiEndpoints for DI (required by Auth and other modules)
const apiEndpoints = APP_CONFIG?.API_ENDPOINTS || {
    AUTH_CSRF: '/api/auth/csrf',
    AUTH_LOGIN: '/api/auth/login',
    AUTH_LOGOUT: '/api/auth/logout',
    AUTH_REGISTER: '/api/auth/register',
    AUTH_VERIFY: '/api/auth/verify',
    AUTH_REFRESH: '/api/auth/refresh'
    // Add other endpoints as needed
};
DependencySystem.register('apiEndpoints', apiEndpoints);

// ---------------------------------------------------------------------------
// 4) Create the actual notification system + register
// ---------------------------------------------------------------------------
const notificationHandler = createNotificationHandler({ DependencySystem, domAPI });
DependencySystem.register('notificationHandler', notificationHandler);

notify = createNotify({
    notificationHandler,
    DependencySystem
});
DependencySystem.register('notify', notify);

 // Debug trace helper (DI-visible as “debugTools”)
 const debugTools = createDebugTools({ notify });
 DependencySystem.register('debugTools', debugTools);
// helper so inner fns don’t keep repeating the lookup
const _dbg = debugTools;

// ---------------------------------------------------------------------------
// 3) Create the event handlers (now notify is initialized)
// ---------------------------------------------------------------------------
const eventHandlers = createEventHandlers({
    DependencySystem,
    domAPI,
    browserService: browserServiceInstance,
    notify,
    APP_CONFIG
});
DependencySystem.register('eventHandlers', eventHandlers);

// Add cleanupModuleListeners to DependencySystem
DependencySystem.cleanupModuleListeners = function(moduleContext) {
  if (!eventHandlers || typeof eventHandlers.cleanupListeners !== 'function') {
    notify.error('[DependencySystem] eventHandlers.cleanupListeners is not available.', {
      source: 'cleanupModuleListeners',
      context: 'DependencySystem' // This is the context for the notify call itself
    });
    return;
  }
  if (!moduleContext || typeof moduleContext !== 'string' || moduleContext.trim() === '') {
    notify.warn('[DependencySystem] cleanupModuleListeners called without a valid moduleContext string. Global cleanup will NOT be performed to prevent unintended side effects. Please provide a specific module context.', {
      source: 'cleanupModuleListeners',
      context: 'DependencySystem', // Notify context
      extra: { providedContext: moduleContext }
    });
    return; // Explicitly do not call global cleanup if context is invalid
  }
  // Ensure an object with a 'context' property is passed to eventHandlers.cleanupListeners
  eventHandlers.cleanupListeners({ context: moduleContext });
  notify.debug(`[DependencySystem] Requested cleanup for module context: ${moduleContext}`, { // Changed log message slightly
    source: 'cleanupModuleListeners',
    context: 'DependencySystem' // Notify context
  });
};


// ---------------------------------------------------------------------------
// 2.5) Build our error-reporting integration (depends on notify)
const sentryManager = createSentryManager({
    config: sentryConfig,
    env: sentryEnv,
    domAPI,
    storage: browserServiceInstance,
    notification: notify,
    navigator: browserAPI.getWindow()?.navigator,
    window: browserAPI.getWindow(),
    document: browserAPI.getDocument(),
    sentryNamespace
});
DependencySystem.register('sentryManager', sentryManager);
DependencySystem.register('errorReporter', sentryManager);
sentryManager.initialize();

// ── Accessibility utilities ───────────────────────────────
notify.warn('[App] About to create AccessibilityUtils. Checking deps (now as WARN):', { // Changed to warn
  source: 'app.js',
  context: 'accessibilitySetup',
  hasDomAPI: !!domAPI,
  hasEventHandlers: !!eventHandlers,
  hasNotify: !!notify,
  hasSentryManagerAsErrorReporter: !!sentryManager,
  typeOfDomAPI: typeof domAPI,
  typeOfEventHandlers: typeof eventHandlers,
  typeOfNotify: typeof notify,
  typeOfSentryManager: typeof sentryManager,
  sentryManagerCaptureExists: typeof sentryManager?.capture === 'function'
});
const accessibilityUtils = createAccessibilityEnhancements({
  domAPI,
            eventHandlers,
            notify,
            errorReporter: sentryManager, // Pass the actual sentryManager instance
            // apiRequest, // Not a dep for accessibilityUtils
        });
DependencySystem.register('accessibilityUtils', accessibilityUtils); // Ensure this line is uncommented
accessibilityUtils.init?.();

// Late-bind the real notify into eventHandlers so all new events use the correct notifier
eventHandlers.setNotifier?.(notify);

// ---------------------------------------------------------------------------
// HTML-template loader
// Now created after real notify and eventHandlers are fully set up.
// ---------------------------------------------------------------------------
const htmlTemplateLoader = createHtmlTemplateLoader({
    DependencySystem,
    domAPI,
    notify // This is the real notify instance
});
DependencySystem.register('htmlTemplateLoader', htmlTemplateLoader);

// Pre-load Project Details HTML (fires 'projectDetailsHtmlLoaded')
notify.info('[App] About to call htmlTemplateLoader.loadTemplate for project_details.html');
const projectDetailsContainer = domAPI.querySelector('#projectDetailsView');
notify.info(`[App] #projectDetailsView found by app.js: ${!!projectDetailsContainer}, childCount: ${projectDetailsContainer?.childElementCount}`);

htmlTemplateLoader.loadTemplate({
    url: '/static/html/project_details.html',
    containerSelector: '#projectDetailsView',
    eventName: 'projectDetailsHtmlLoaded'
});
notify.info('[App] Called htmlTemplateLoader.loadTemplate for project_details.html');

// Pre-load Project List HTML (fires 'projectListHtmlLoaded')
notify.info('[App] About to call htmlTemplateLoader.loadTemplate for project_list.html');
const projectListContainerCheck = domAPI.querySelector('#projectListView');
notify.info(`[App] #projectListView found by app.js: ${!!projectListContainerCheck}, childCount: ${projectListContainerCheck?.childElementCount}`);

htmlTemplateLoader.loadTemplate({
    url: '/static/html/project_list.html',
    containerSelector: '#projectListView', // Standard container for the project list view
    eventName: 'projectListHtmlLoaded'
});
notify.info('[App] Called htmlTemplateLoader.loadTemplate for project_list.html');

// ---------------------------------------------------------------------------
// Global error catch (fail-fast at window level) – now using eventHandlers for tracking
if (typeof window !== 'undefined') {
    const globalWin = browserAPI.getWindow?.() || window;
    eventHandlers.trackListener(
        globalWin,
        'error',
        (e) => notify.error(e.message, { source: 'global' }),
        { context: 'app', description: 'Global window error listener' }
    );
    eventHandlers.trackListener(
        globalWin,
        'unhandledrejection',
        (e) => notify.error(e.reason?.message || 'unhandled rejection', { source: 'global' }),
        { context: 'app', description: 'Global unhandledrejection listener' }
    );
}

 // ---------------------------------------------------------------------------
 // 5) Create the unified apiRequest using our new “createApiClient”
 // ---------------------------------------------------------------------------
const apiRequest = createApiClient({
    APP_CONFIG,
    globalUtils : { shouldSkipDedup, stableStringify, normaliseUrl, isAbsoluteUrl },
    notify,
    errorReporter      : sentryManager,
    getAuthModule      : () => DependencySystem.modules.get('auth'),
    browserService     : browserServiceInstance
});
DependencySystem.register('apiRequest', apiRequest);

 // ---------------------------------------------------------------------------
 // 6) Now define app meta-state
 // ---------------------------------------------------------------------------
let currentUser = null;
const appState = {
    initialized: false,
    initializing: false,
    isAuthenticated: false,
    currentPhase: 'idle'
};

// Global flags preventing re-init
let _globalInitCompleted = false;
let _globalInitInProgress = false;

// The main app object
const app = {
    getProjectId: () => {
        const { search } = browserAPI.getLocation();
        return new URLSearchParams(search).get('project');
    },
    navigateToConversation: async (chatId) => {
        const chatMgr = DependencySystem.modules.get('chatManager');
        if (chatMgr?.loadConversation) return chatMgr.loadConversation(chatId);
        notify.warn('[App] chatManager not available for navigateToConversation');
        return false;
    },
    validateUUID: (id) => isValidProjectId(id)   // ← nuevo
};

// Attach apiRequest directly to app before creating ProjectManager
app.apiRequest = apiRequest;

// Expose the central state so other modules (ProjectManager, ProjectDashboard, etc.)
// can consult `app.state.isAuthenticated`
app.state = appState;

// Register the app object
DependencySystem.register('app', app);

// Register currentUser initially as null. It will be updated via app.state.currentUser and events.
DependencySystem.register('currentUser', null);
notify.info('[App] "currentUser" initially registered as null in DI.');

// ---------------------------------------------------------------------------
// 7) Main init
// ---------------------------------------------------------------------------
export async function init() {
    const _trace = _dbg.start?.('App.init');
    if (_globalInitCompleted || _globalInitInProgress) {
        notify.warn('[App] Duplicate initialization attempt blocked');
        return _globalInitCompleted;
    }
    if (appState.initialized || appState.initializing) {
        notify.info('[App] Initialization attempt skipped (already done or in progress).');
        return appState.initialized;
    }

    _globalInitInProgress = true;
    appState.initializing = true;
    appState.currentPhase = 'starting_init_process';
    notify.debug('[App] START init()');

    // Show loading spinner
    toggleLoadingSpinner(true);

    try {
        await initializeCoreSystems();
        try {
            await DependencySystem.waitFor(
                ['auth', 'eventHandlers', 'notificationHandler', 'modalManager'],
                null,
                APP_CONFIG.TIMEOUTS?.DEPENDENCY_WAIT
            );
        } catch (err) {
            notify.error('[App] Critical deps not met', { error: err });
            throw err;
        }
        await initializeAuthSystem();

        if (appState.isAuthenticated) {
            const user = await fetchCurrentUser();
            notify.debug('[App] Auth verify/fetchCurrentUser response', { extra: { user } });
            notify.debug('[App] Before set currentUser', { extra: { currentUser, stateCurrentUser: app.state.currentUser } });
            if (user) {
                currentUser = user; // Update module-scoped variable
                app.state.currentUser = user; // Update shared state object
                browserAPI.setCurrentUser(user); // Update browser API's context
                // Do NOT re-register 'currentUser' in DI here. It's set once initially.
                // Modules should get the dynamic user state from app.state.currentUser or auth events.
                notify.info(`[App] User fetched in init. app.state.currentUser updated. User ID: ${user.id}`);
                renderAuthHeader();
                notify.debug('[App] After set currentUser in init', { extra: { moduleCurrentUser: currentUser, stateCurrentUser: app.state.currentUser } });
            }
        }

        await initializeUIComponents();

    // Finalize eventHandlers
    try {
        const eh = DependencySystem.modules.get('eventHandlers');
        if (eh?.init) {
            await eh.init();
            notify.info('EventHandlers initialized successfully');
        }
    } catch (ehErr) {
        notify.error('[App] Error initializing eventHandlers', { error: ehErr });
    }

        // If you have extra optional modules:
        try {
            const mc = DependencySystem.modules.get('modelConfig') || null;
            if (mc?.initializeUI) {
                mc.initializeUI();
            }
        } catch (mcErr) {
            notify.warn('[App] Error initializing modelConfig UI', { error: mcErr });
        }

        registerAppListeners();
        handleNavigationChange();

        appState.initialized = true;
        _globalInitCompleted = true;
        notify.info('[App] Initialization complete.', { authenticated: appState.isAuthenticated });
        // Use domAPI.dispatchEvent on domAPI.getDocument() if available
        if (domAPI && typeof domAPI.dispatchEvent === 'function' && typeof domAPI.getDocument === 'function') {
            domAPI.dispatchEvent(domAPI.getDocument(), new CustomEvent('app:ready', { detail: { success: true } }));
        } else {
            document.dispatchEvent(new CustomEvent('app:ready', { detail: { success: true } }));
        }
        return true;
    } catch (err) {
        notify.error(`[App] Initialization failed: ${err?.message}`, { error: err });
        handleInitError(err);
        if (domAPI && typeof domAPI.dispatchEvent === 'function' && typeof domAPI.getDocument === 'function') {
            domAPI.dispatchEvent(domAPI.getDocument(), new CustomEvent('app:ready', { detail: { success: false, error: err } }));
        } else {
            document.dispatchEvent(new CustomEvent('app:ready', { detail: { success: false, error: err } }));
        }
        return false;
    } finally {
        _globalInitInProgress = false;
        appState.initializing = false;
        toggleLoadingSpinner(false);
        appState.currentPhase = appState.initialized ? 'initialized_idle' : 'failed_idle';
        _dbg.stop?.(_trace, 'App.init');
    }
}
// 8) Core systems initialization
// ---------------------------------------------------------------------------
async function initializeCoreSystems() {
    const _t = _dbg.start?.('initializeCoreSystems');
    try {
        notify.debug('[App] Initializing core systems...');
        // Ensure DOM is ready using shared util (also future-proofs for SSR tests)
        await waitForDepsAndDom({ DependencySystem, domAPI });

        // Initialize modal manager
        const modalManager = createModalManager({
            domAPI,
            browserService: browserServiceInstance,
            eventHandlers,
            DependencySystem,
            modalMapping: MODAL_MAPPINGS,
            notify,
            domPurify: sanitizer
        });
        DependencySystem.register('modalManager', modalManager);

        // Auth
        const authModule = createAuthModule({
            DependencySystem, // Pass DependencySystem
            apiRequest,
            notify,
            eventHandlers,
            domAPI,
            sanitizer: DependencySystem.modules.get('sanitizer'),
            modalManager,
            apiEndpoints: DependencySystem.modules.get('apiEndpoints')
        });
        DependencySystem.register('auth', authModule);

        // Model-config (debe existir antes de ProjectManager)
        const modelConfigInstance = createModelConfig({ DependencySystem, notify });
        DependencySystem.register('modelConfig', modelConfigInstance);

        // Ensure chatManager is available prior to projectManager creation
        // FIX: Define chatManager by calling createOrGetChatManager
        // createOrGetChatManager will handle registration internally if it creates a new instance.
        const chatManager = createOrGetChatManager();

        // Project manager
        const projectManager = createProjectManager({
            DependencySystem,
            chatManager,
            app,
            modelConfig: modelConfigInstance,      // ← nuevo
            notify,
            debugTools,
            apiRequest, // <-- inject directly
            apiEndpoints: DependencySystem.modules.get('apiEndpoints'),
            storage: DependencySystem.modules.get('storage'),
            listenerTracker: {
                add: (element, type, handler, description) => eventHandlers.trackListener(element, type, handler, { description, context: 'projectManager' }),
                remove: () => eventHandlers.cleanupListeners({ context: 'projectManager' })
            }
        });
        DependencySystem.register('projectManager', projectManager);
        // Sincroniza projectManager con eventHandlers
        eventHandlers.setProjectManager?.(projectManager);

        // Project modal
        const projectModal = createProjectModal({
            DependencySystem,
            eventHandlers,
            notify,
            domAPI,
            browserService: browserServiceInstance,
            domPurify: sanitizer
        });
        DependencySystem.register('projectModal', projectModal);

        // Wait for modals load signal
        let modalsLoadedSuccess = false;
        await new Promise((res) => {
            eventHandlers.trackListener(
                domAPI.getDocument(),
                'modalsLoaded',
                (e) => {
                    modalsLoadedSuccess = !!(e?.detail?.success);
                    if (!modalsLoadedSuccess) {
                        notify.error('[App] modalsLoaded event fired but modals failed to load', { error: e?.detail?.error });
                    } else {
                        notify.info('[App] modalsLoaded event fired: modals injected successfully');
                    }
                    res(true);
                },
                { once: true, description: 'modalsLoaded for app init', context: 'app' }
            );
        });

        if (!modalsLoadedSuccess) {
            notify.error('[App] Modal HTML failed to load. Login modal and others will not function.');
        }

        // No longer initializing authUI—auth logic is now entirely internal to auth.js

        if (modalManager.init) {
            try {
                await modalManager.init();
                notify.info('[App] modalManager.init() completed successfully');
            } catch (err) {
                notify.error('[App] modalManager.init() failed', { error: err });
            }
        }

        // After modalManager is initialized, force a rebind of login button delegation
        // This ensures eventHandlers sees the now-present modalManager and login modal
        if (eventHandlers?.init) {
            try {
                await eventHandlers.init();
                notify.info('[App] eventHandlers.init() completed (rebinding login delegation)');
            } catch (err) {
                notify.error('[App] eventHandlers.init() failed', { error: err });
            }
        }

        // Always register chatManager so dependencies are satisfied
        // If user is authed, initialize chatManager
        if (appState.isAuthenticated && chatManager?.initialize) {
            await chatManager.initialize({ projectId: app.getProjectId() });
        }

        // Initialize projectManager
        if (projectManager.initialize) {
            await projectManager.initialize();
        }
        if (projectModal.init) {
            projectModal.init();
        }

        notify.debug('[App] Core systems initialized.');
    } catch (err) {
        const errorReporter = DependencySystem.modules.get('errorReporter');
        maybeCapture(errorReporter, err, {
            module: 'app',
            method: 'initializeCoreSystems'
        });
        notify.error('[App] Core systems initialization failed.', {
            error: err,
            module: 'app',
            source: 'initializeCoreSystems'
        });
        throw err;
    } finally {
        _dbg.stop?.(_t,'initializeCoreSystems');
    }
}

// ---------------------------------------------------------------------------
// 9) Auth system
// ---------------------------------------------------------------------------
async function initializeAuthSystem() {
    const auth = DependencySystem.modules.get('auth');
    if (!auth?.init) {
        throw new Error('[App] Auth module is missing or invalid.');
    }
    try {
        await auth.init();
        appState.isAuthenticated = auth.isAuthenticated();
        // register bus listener
        if (auth.AuthBus) {
            eventHandlers.trackListener(
                auth.AuthBus,
                'authStateChanged',
                handleAuthStateChange,
                { description: '[App] AuthBus authStateChanged', context: 'app' }
            );
            eventHandlers.trackListener(
                auth.AuthBus,
                'authReady',
                handleAuthStateChange,
                { description: '[App] AuthBus authReady', context: 'app' }
            );
        }
        renderAuthHeader();
    } catch (err) {
        appState.isAuthenticated = false;
        notify.error('[App] Auth system initialization failed.', { error: err });
        throw err;
    }
}

function renderAuthHeader() {
    try {
        const authMod = DependencySystem.modules.get('auth');
        const isAuth = authMod?.isAuthenticated?.();
        const user = currentUser || { username: authMod?.getCurrentUser?.() };
        const authBtn = domAPI.getElementById('authButton');
        const userMenu = domAPI.getElementById('userMenu');
        const logoutBtn = domAPI.getElementById('logoutBtn');
        const userInitialsEl = domAPI.getElementById('userInitials');
        const authStatus = domAPI.getElementById('authStatus');
        const userStatus = domAPI.getElementById('userStatus');
        // const authContainer = domAPI.getElementById('authContainer'); // Unused variable

        notify.debug('[App] renderAuthHeader invoked', {
            isAuth,
            authBtnExists: !!authBtn,
            authBtnHidden: authBtn ? authBtn.classList.contains('hidden') : 'n/a'
        });

        if (isAuth) {
            if (authBtn) domAPI.addClass(authBtn, 'hidden');   // sigue oculto al estar logueado
            if (userMenu) domAPI.removeClass(userMenu, 'hidden');
        } else {
            if (authBtn) domAPI.removeClass(authBtn, 'hidden'); // mostrar botón Login
            if (userMenu) domAPI.addClass(userMenu, 'hidden');  // ocultar menú usuario
            // Asegura limpieza de cualquier resto previo
            const orphan = domAPI.getElementById('headerLoginForm');
            if (orphan) orphan.remove();
        }
        // Update user initials and details if logged in
        if (isAuth && userMenu && userInitialsEl) {
            let initials = '?';
            if (user.name) {
                initials = user.name.trim().split(/\s+/).map(p => p[0]).join('').toUpperCase();
            } else if (user.username) {
                initials = user.username.trim().slice(0, 2).toUpperCase();
            }
            domAPI.setTextContent(userInitialsEl, initials);
        }
        // Auth status text
        if (authStatus) {
            domAPI.setTextContent(authStatus, isAuth ?
                (user?.username ? `Signed in as ${user.username}` : 'Authenticated') :
                'Not Authenticated'
            );
        }
        // User status text ("Offline" or greeting)
        if (userStatus) {
            domAPI.setTextContent(userStatus, isAuth && user?.username ?
                `Hello, ${user.name ?? user.username}` : 'Offline'
            );
        }
        // Logout button: bind logout if authenticated
        if (logoutBtn) {
            eventHandlers.trackListener(
                logoutBtn,
                'click',
                (e) => {
                    domAPI.preventDefault(e);
                    authMod?.logout?.();
                },
                { description: 'Auth logout button', context: 'app' }
            );
        }
    } catch (err) {
        notify.error('[App] Error rendering auth header.', { error: err });
    }
}

async function fetchCurrentUser() {
    try {
        const authModule = DependencySystem.modules.get('auth');
        if (!authModule) {
            notify.error('[App] Auth module not available in fetchCurrentUser.');
            return null;
        }

        // Priority 1: Use the dedicated async fetchCurrentUser from auth.js
        if (authModule.fetchCurrentUser && typeof authModule.fetchCurrentUser === 'function') {
            const userObj = await authModule.fetchCurrentUser();
            if (userObj && typeof userObj === 'object' && userObj.id) {
                notify.debug('[App] fetchCurrentUser: Successfully fetched user object via authModule.fetchCurrentUser.', { userObj });
                return userObj;
            }
            notify.warn('[App] fetchCurrentUser (from authModule.fetchCurrentUser) did not return a valid user object with ID.', { userObj });
        }

        // Priority 2: Fallback to getCurrentUserObject if fetchCurrentUser wasn't available or didn't yield a result
        if (authModule.getCurrentUserObject && typeof authModule.getCurrentUserObject === 'function') {
            const userObjFromGetter = authModule.getCurrentUserObject();
            if (userObjFromGetter && typeof userObjFromGetter === 'object' && userObjFromGetter.id) {
                notify.debug('[App] fetchCurrentUser: Successfully fetched user object via authModule.getCurrentUserObject.', { userObjFromGetter });
                return userObjFromGetter;
            }
            notify.warn('[App] fetchCurrentUser (from authModule.getCurrentUserObject) did not return a valid user object with ID.', { userObjFromGetter });
        }

        // Priority 3: Check getCurrentUserAsync (if it was a previously used name for fetchCurrentUser)
        if (authModule.getCurrentUserAsync && typeof authModule.getCurrentUserAsync === 'function') {
            const userObjAsync = await authModule.getCurrentUserAsync();
            if (userObjAsync && typeof userObjAsync === 'object' && userObjAsync.id) {
                notify.debug('[App] fetchCurrentUser: Successfully fetched user object via authModule.getCurrentUserAsync.', { userObjAsync });
                return userObjAsync;
            }
            notify.warn('[App] fetchCurrentUser (from authModule.getCurrentUserAsync) did not return a valid user object with ID.', { userObjAsync });
        }

        notify.error('[App] fetchCurrentUser: Could not retrieve a valid user object with ID from auth module using any available method.');
        return null;
    } catch (error) {
        notify.error('[App] Failed to fetch current user during fetchCurrentUser execution.', { error });
        return null;
    }
}

// ---------------------------------------------------------------------------
// 10) UI components
// ---------------------------------------------------------------------------
let _uiInitialized = false;

async function initializeUIComponents() {
    const _t = _dbg.start?.('initializeUIComponents');
    try {
        if (_uiInitialized) {
            notify.warn('[App] initializeUIComponents called again; skipping.');
            return;
        }
        notify.debug('[App] Initializing UI components...');

        // Ensure DOM element for ProjectList and ProjectDetailsView exists before continuing.
        await waitForDepsAndDom({
            DependencySystem,
            domAPI,
            domSelectors: ['#projectList', '#projectDetailsView']
        });

        // -------------------------------------------------------------------
        // Resolve concrete dependency instances up-front for strict DI
        // -------------------------------------------------------------------
        const projectManager = DependencySystem.modules.get('projectManager');
        const modalManager = DependencySystem.modules.get('modalManager');
        // Register or create any optional modules
        if (FileUploadComponent) {
            DependencySystem.register('FileUploadComponent', FileUploadComponent);
        }
        const fileUploadComponentClass = DependencySystem.modules.get('FileUploadComponent');
        const authModule = DependencySystem.modules.get('auth');

        const chatExtensionsInstance = createChatExtensions({
            DependencySystem, eventHandlers, notificationHandler: notify
        });
        DependencySystem.register('chatExtensions', chatExtensionsInstance);

        let modelConfigInstance = DependencySystem.modules.get('modelConfig');
        if (!modelConfigInstance) {
          modelConfigInstance = createModelConfig({ DependencySystem, notify });
          DependencySystem.register('modelConfig', modelConfigInstance);
        }

        const projectDashboardUtilsInstance = createProjectDashboardUtils({
            DependencySystem
        });
        DependencySystem.register('projectDashboardUtils', projectDashboardUtilsInstance);

        const projectListComponentInstance = new ProjectListComponent({
            projectManager,
            eventHandlers,
            modalManager,
            app,
            router: {
                navigate: (url) => {
                    notify.debug('[App] ProjectList router.navigate called with URL:', { urlToPush: url, currentWindowLocation: browserAPI.getLocation().href });
                    browserAPI.getHistory().pushState({}, '', url);
                    domAPI.dispatchEvent(browserAPI.getWindow(), new Event('locationchange'));
                },
                getURL: () => browserAPI.getLocation().href
            },
            notify,
            storage: DependencySystem.modules.get('storage'),
            sanitizer: DependencySystem.modules.get('sanitizer'),
            domAPI,
            browserService: browserServiceInstance,
            globalUtils: DependencySystem.modules.get('globalUtils') // Added globalUtils
        });
        DependencySystem.register('projectListComponent', projectListComponentInstance);

        const projectDashboardInstance = createProjectDashboard(DependencySystem);
        DependencySystem.register('projectDashboard', projectDashboardInstance);

        // Details component expects DI with proper router methods
        const detailsRouter = {
            navigate: (url) => {
                browserAPI.getHistory().pushState({}, '', url);
                domAPI.dispatchEvent(browserAPI.getWindow(), new Event('locationchange'));
            },
            getURL: () => browserAPI.getLocation().href
        };

        // const authModule = DependencySystem.modules.get('auth'); // Ensure authModule is defined - Already defined and registered
        // const projectManager = DependencySystem.modules.get('projectManager'); // Ensure projectManager is defined - Already defined and registered
        // const apiRequest = DependencySystem.modules.get('apiRequest'); // Ensure apiRequest is defined - Already defined and registered

        const knowledgeBaseComponentInstance = createKnowledgeBaseComponent({
            DependencySystem,
            apiRequest,
            auth: authModule,
            projectManager,
            uiUtils,                           // ahora módulo real con helpers
            sanitizer: DependencySystem.modules.get('sanitizer')
        });
        DependencySystem.register('knowledgeBaseComponent', knowledgeBaseComponentInstance);

        const projectDetailsComponentInstance = createProjectDetailsComponent({
            projectManager,
            eventHandlers,
            modalManager,
            FileUploadComponentClass: fileUploadComponentClass,
            router: detailsRouter,
            domAPI,
            notify,
            sanitizer: DependencySystem.modules.get('sanitizer'),
            app,
            // Inject chat-related dependencies so Conversations tab is fully functional
            chatManager: DependencySystem.modules.get('chatManager'),
            modelConfig: modelConfigInstance,
            knowledgeBaseComponent: knowledgeBaseComponentInstance, // Wire KB component
            onBack: async () => {
                let pd;
                try {
                    pd = await DependencySystem.waitFor('projectDashboard');
                } catch (err) {
                    notify.error('[App] Dependency not met: projectDashboard', { error: err });
                    throw err;
                }
                pd?.showProjectList?.();
            }
        });
        DependencySystem.register('projectDetailsComponent', projectDetailsComponentInstance);

        // Actualiza el ProjectDashboard con las instancias ya creadas
        if (projectDashboardInstance?.components) {
            projectDashboardInstance.components.projectDetails = projectDetailsComponentInstance;
            projectDashboardInstance.components.projectList    = projectListComponentInstance;
        }

        // ── AccessibilityUtils for Sidebar ──
        const accessibilityUtils = DependencySystem.modules.get('accessibilityUtils');

        // Define callbacks for uiRenderer
        const onConversationSelect = async (conversationId) => {
            const chatManager = DependencySystem.modules.get('chatManager');
            if (chatManager && typeof chatManager.loadConversation === 'function') {
                try {
                    await chatManager.loadConversation(conversationId);
                } catch (err) {
                    notify.error('[App] Failed to load conversation from uiRenderer selection.', { error: err, conversationId });
                }
            } else {
                notify.error('[App] chatManager not available for onConversationSelect.', { conversationId });
            }
        };

        const onProjectSelect = async (projectId) => {
            const projectDashboardDep = DependencySystem.modules.get('projectDashboard');
            if (projectDashboardDep && typeof projectDashboardDep.showProjectDetails === 'function') {
                try {
                    await projectDashboardDep.showProjectDetails(projectId);
                } catch (err) {
                    notify.error('[App] Failed to show project details from uiRenderer selection.', { error: err, projectId });
                }
            } else {
                notify.error('[App] projectDashboard not available for onProjectSelect.', { projectId });
            }
        };

        // Create uiRenderer instance
        const uiRendererInstance = createUiRenderer({
            domAPI,
            eventHandlers,
            notify,
            apiRequest,
            apiEndpoints: apiEndpoints, // Pass the apiEndpoints variable directly
            onConversationSelect,
            onProjectSelect,
        });
        DependencySystem.register('uiRenderer', uiRendererInstance); // Register it for potential other uses

        const sidebarInstance = createSidebar({
            DependencySystem,
            eventHandlers,
            app,
            projectDashboard: projectDashboardInstance,
            projectManager,
            uiRenderer: uiRendererInstance, // Inject the created uiRenderer
            notify,
            storageAPI: DependencySystem.modules.get('storage'),
            domAPI,
            viewportAPI : { getInnerWidth: () => browserAPI.getInnerWidth() },
            accessibilityUtils
        });
        DependencySystem.register('sidebar', sidebarInstance);

        // Init each piece
        await safeInit(sidebarInstance, 'Sidebar', 'init');
        await safeInit(chatExtensionsInstance, 'ChatExtensions', 'init');
        await safeInit(knowledgeBaseComponentInstance, 'KnowledgeBase', 'initialize');
        await safeInit(projectDashboardInstance, 'ProjectDashboard', 'initialize');
        await safeInit(projectListComponentInstance, 'ProjectList', 'initialize');
        await safeInit(projectDetailsComponentInstance, 'ProjectDetails', 'initialize');

        // If authenticated, tell projectManager to load projects
        if (appState.isAuthenticated) {
            const pm = DependencySystem.modules.get('projectManager');
            pm?.loadProjects?.('all').catch(err => {
                notify.error('[App] Failed to load projects in UI init', { error: err });
            });
        }

        // Optionally call external (injected) enhancements
        const w = browserAPI.getWindow();
        w.initAccessibilityEnhancements?.({ domAPI, notify });
        w.initSidebarEnhancements?.({ domAPI, notify, eventHandlers });

        _uiInitialized = true;
        notify.debug('[App] UI components initialized.');
    } catch (err) {
        const errorReporter = DependencySystem.modules.get('errorReporter');
        maybeCapture(errorReporter, err, {
            module: 'app',
            method: 'initializeUIComponents'
        });
        notify.error('[App] UI components initialization failed.', {
            error: err,
            module: 'app',
            source: 'initializeUIComponents'
        });
        throw err;
    } finally {
        _dbg.stop?.(_t,'initializeUIComponents');
    }
}

async function safeInit(instance, name, method = 'init') {
  if (typeof instance?.[method] !== 'function') return;
  const errorReporter = DependencySystem.modules.get?.('errorReporter');
  const wrapped = safeInvoker(
    instance[method].bind(instance),
    { notify, errorReporter },
    { context: 'app', module: name, source: method }
  );
  await wrapped();        // errors now handled by notifications-helpers util
}

// ---------------------------------------------------------------------------
// 11) Global listeners & navigation
// ---------------------------------------------------------------------------
function registerAppListeners() {
    notify.debug('[App] Registering global application listeners...');
    DependencySystem.waitFor(['auth', 'chatManager', 'projectManager', 'eventHandlers'])
        .then(() => {
            setupChatInitializationTrigger();
            eventHandlers.trackListener(
                browserAPI.getWindow(), // or document if needed
                'locationchange',
                handleNavigationChange,
                { description: 'locationchange -> handleNavigationChange', context: 'app' }
            );
        })
        .catch((err) => {
            notify.error('[App] Failed to wait for dependencies for global listeners.', { error: err });
        });
    notify.debug('[App] Global application listeners registered.');
}

function setupChatInitializationTrigger() {
    // Similar logic from earlier “debounced chat init” approach ...
    // ...
}

// Track the last handled project/chat to skip repeated loads
let lastHandledProj = null;
let lastHandledChat = null;

async function handleNavigationChange(options = {}) { // Accept options
    const { forceListView } = options;
    // Generate a traceId for this navigation event for grouping logs
    const traceId = (typeof crypto !== "undefined" && crypto.randomUUID)
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    try {
        notify.debug('[App] handleNavigationChange: Navigation event triggered', {
            context: 'navigation',
            traceId,
            url: browserAPI.getLocation().href
        });
        if (!appState.initialized) {
            // If still not ready, short-circuit or wait briefly
            if (appState.initializing) {
                notify.debug('[App] handleNavigationChange: Waiting for initialization', { context: 'navigation', traceId });
                await new Promise(r => browserAPI.requestAnimationFrame(r));
                if (!appState.initialized) {
                    notify.warn("[App] handleNavigationChange: Aborted, initialization didn't complete in time.", { context: 'navigation', traceId });
                    return;
                }
            } else {
                notify.warn("[App] handleNavigationChange: Aborted, application not initialized.", { context: 'navigation', traceId });
                return;
            }
        }
        notify.info('[App] Navigation changed', {
            context: 'navigation',
            traceId,
            url: browserAPI.getLocation().href
        });

        let projectDashboard;
        try {
            notify.debug('[App] Waiting for projectDashboard dependency', { context: 'navigation', traceId });
            projectDashboard = await DependencySystem.waitFor('projectDashboard', null, APP_CONFIG.TIMEOUTS?.DEPENDENCY_WAIT);
            notify.debug('[App] projectDashboard retrieved in handleNavigationChange', {
                context: 'navigation',
                traceId,
                projectDashboardExists: !!projectDashboard,
                typeofProjectDashboard: typeof projectDashboard,
                projectDashboardKeys: projectDashboard ? Object.keys(projectDashboard).join(', ') : 'N/A',
                hasShowProjectList: projectDashboard ? typeof projectDashboard.showProjectList === 'function' : 'N/A'
            });
            notify.debug('[App] projectDashboard dependency resolved', { context: 'navigation', traceId });
        } catch (e) {
            notify.error('[App] Project Dashboard unavailable for navigation.', { error: e, context: 'navigation', traceId });
            toggleElement(APP_CONFIG.SELECTORS.APP_FATAL_ERROR, true);
            return;
        }

        // User suggested log:
        console.log('[App Debug] Retrieved projectDashboard for navigation:', projectDashboard, typeof projectDashboard?.showProjectList);

        const projectId = forceListView ? null : browserServiceInstance.getSearchParam('project');
        const chatId    = forceListView ? null : browserServiceInstance.getSearchParam('chatId');

        notify.debug('[App] Navigation state', {
            context: 'navigation',
            traceId,
            projectId,
            chatId,
            lastHandledProj,
            lastHandledChat
        });

        if (projectId === lastHandledProj && chatId === lastHandledChat) {
            notify.debug('[App] Same project/chat; skipping re-load.', { context: 'navigation', traceId });
            return;
        }
        lastHandledProj = projectId;
        lastHandledChat = chatId;

        if (!appState.isAuthenticated) {
            notify.info('[App] Not authenticated -> show login required', { context: 'navigation', traceId });
            projectDashboard.showLoginRequiredMessage?.();
            return;
        }
        toggleElement(APP_CONFIG.SELECTORS.LOGIN_REQUIRED_MESSAGE, false);

        try {
            notify.debug('[App] Waiting for projectManager dependency', { context: 'navigation', traceId });
            const pm = await DependencySystem.waitFor('projectManager', null, APP_CONFIG.TIMEOUTS?.DEPENDENCY_WAIT);
            notify.debug('[App] projectManager dependency resolved', { context: 'navigation', traceId });

            if (projectId) {
                notify.info('[App] Loading project details', { context: 'navigation', traceId, projectId });
                await pm.loadProjectDetails(projectId);
                notify.info('[App] Showing project details', { context: 'navigation', traceId, projectId });
                await projectDashboard.showProjectDetails(projectId);

                // If navigating to a specific chat within the project
                if (chatId) {
                    notify.info('[App] Navigating to conversation within project', { context: 'navigation', traceId, chatId });
                    const chatMgr = DependencySystem.modules.get('chatManager');
                    if (chatMgr?.loadConversation) {
                        await chatMgr.loadConversation(chatId);
                    } else {
                        notify.warn('[App] chatManager not available for navigateToConversation in handleNavigationChange', { context: 'navigation', traceId });
                    }
                }
            } else {
                notify.info('[App] No project ID in URL, showing project list.', { context: 'navigation', traceId });
                if (projectDashboard && typeof projectDashboard.showProjectList === 'function') {
                    await projectDashboard.showProjectList();
                } else {
                    notify.error('[App] projectDashboard.showProjectList is not a function (else branch)', {
                        context: 'navigation',
                        traceId,
                        projectDashboardExists: !!projectDashboard,
                        typeOfShowProjectList: projectDashboard ? typeof projectDashboard.showProjectList : 'N/A',
                        constructorName: projectDashboard?.constructor?.name,
                        projectDashboardInstance: projectDashboard
                    });
                    // Attempt to show login required as a last resort if project list can't be shown
                    projectDashboard?.showLoginRequiredMessage?.();
                }
            }
        } catch (navErr) {
            notify.error('[App] Error during navigation logic.', {
                error: navErr,
                fullError: navErr ? navErr.toString() : 'undefined',
                stack: navErr ? navErr.stack : 'no stack',
                context: 'navigation',
                traceId
            });

            // --- BEGIN DIAGNOSTIC LOGGING for TypeError ---
            if (projectDashboard) {
                const isShowProjectListFunction = typeof projectDashboard.showProjectList === 'function';
                notify.warn('[App] Diagnosing projectDashboard in navErr catch block', {
                    context: 'navigation',
                    traceId,
                    projectDashboardExists: !!projectDashboard,
                    typeOfProjectDashboard: typeof projectDashboard,
                    projectDashboard_showProjectList_property: projectDashboard.showProjectList, // Log the actual property value
                    typeOf_showProjectList: typeof projectDashboard.showProjectList,
                    isShowProjectListActuallyFunction: isShowProjectListFunction,
                    constructorName: projectDashboard?.constructor?.name,
                    instanceHasShowProjectDetails: typeof projectDashboard.showProjectDetails === 'function' // Check another method
                });

                if (!isShowProjectListFunction) {
                    notify.error('[App] CRITICAL: projectDashboard.showProjectList is NOT a function in catch block.', {
                        context: 'navigation',
                        traceId,
                        propertyValue: projectDashboard.showProjectList
                    });
                }
            } else {
                notify.error('[App] CRITICAL: projectDashboard is null or undefined in navErr catch block.', { context: 'navigation', traceId });
            }
            // --- END DIAGNOSTIC LOGGING ---

            // Attempt to call showProjectList, relying on optional chaining for safety if projectDashboard itself is null/undefined.
            // The primary concern is if projectDashboard.showProjectList is defined but *not* a function.
            if (projectDashboard && typeof projectDashboard.showProjectList === 'function') {
                projectDashboard.showProjectList().catch(fbErr => {
                    notify.error('[App] Fallback to showProjectList also failed.', { error: fbErr, context: 'navigation', traceId });
                });
            } else {
                 notify.error('[App] Cannot call projectDashboard.showProjectList in fallback because it is not a function or projectDashboard is missing.', {
                    context: 'navigation',
                    traceId,
                    projectDashboardExists: !!projectDashboard,
                    typeOfShowProjectList: projectDashboard ? typeof projectDashboard.showProjectList : 'N/A'
                });
                // As an absolute fallback, try to show the login message if all else fails.
                projectDashboard?.showLoginRequiredMessage?.();
            }
        }
    } catch (err) {
        const errorReporter = DependencySystem.modules.get('errorReporter');
        maybeCapture(errorReporter, err, {
            module: 'app',
            method: 'handleNavigationChange',
            traceId
        });
        notify.error('[App] Navigation change handler failed.', {
            error: err,
            module: 'app',
            source: 'handleNavigationChange',
            context: 'navigation',
            traceId
        });
        throw err;
    }
}

// ---------------------------------------------------------------------------
// 12) Auth state changes
// ---------------------------------------------------------------------------
function handleAuthStateChange(e) {
    const { authenticated, user } = e.detail || {};
    const newAuthState = !!authenticated;

    // Avoid redundant updates if auth state and user object reference are identical
    if (newAuthState === appState.isAuthenticated && user === app.state.currentUser) {
        notify.debug('[App] handleAuthStateChange: No actual change in auth state or user object.', {
            authenticated, userId: user?.id
        });
        return;
    }

    const prevAuth = appState.isAuthenticated;
    appState.isAuthenticated = newAuthState;

    // CRITICAL: Update app.state.currentUser with the user from the event
    // This ensures all modules see the most up-to-date user information.
    currentUser = user; // Update module-scoped variable
    app.state.currentUser = user; // Update shared state object
    browserAPI.setCurrentUser(user); // Update browser API's context

    // We no longer attempt to update 'currentUser' in the DependencySystem here
    // after its initial registration as null.
    // Modules should rely on app.state.currentUser or listen to 'authStateChanged' events
    // for dynamic user information.

    notify.info(`[App] app.state.currentUser updated. User ID: ${app.state.currentUser ? app.state.currentUser.id : 'null'}. Authenticated: ${newAuthState}`);
    // Note: If newAuthState is true but `user` from event is undefined,
    // `fetchCurrentUser` (if called subsequently) should populate it.

    notify.info(`[App] Auth state changed: ${prevAuth} -> ${appState.isAuthenticated}. User: ${app.state.currentUser ? app.state.currentUser.id : 'none'}`);
    renderAuthHeader(); // Re-render header with new user state

    // --- DISPATCH authStateChanged on document for all listeners (e.g. ProjectListComponent) ---
    try {
        const doc = domAPI?.getDocument?.() || document;
        // Pass the potentially updated user object in the event detail
        doc.dispatchEvent(new CustomEvent("authStateChanged", { detail: { authenticated: appState.isAuthenticated, user: app.state.currentUser } }));
    } catch (err) {
        notify.warn("[App] Failed to dispatch authStateChanged on document", { error: err });
    }

    (async () => {
        const pm = DependencySystem.modules.get('projectManager');
        const pd = DependencySystem.modules.get('projectDashboard');
        const sb = DependencySystem.modules.get('sidebar');
        const cm = DependencySystem.modules.get('chatManager');
        const st = DependencySystem.modules.get('storage');
        const authModule = DependencySystem.modules.get('auth');

        if (appState.isAuthenticated && !prevAuth) {
            // Just Logged IN
            notify.debug('[App] User logged in -> refreshing data/UI.');
            if (!app.state.currentUser && authModule?.getCurrentUserAsync) {
                // If event didn't provide user or it's incomplete, try to re-fetch.
                // This can happen if 'authStateChanged' event from auth module only signals 'authenticated:true'
                // without full user details immediately.
                notify.info('[App] User authenticated, but user details missing from event. Attempting fetch...');
                try {
                    const freshUser = await authModule.getCurrentUserAsync();
                    if (freshUser) {
                        currentUser = freshUser; // Update module-scoped
                        app.state.currentUser = freshUser; // Update shared state
                        // Do not re-register 'currentUser' in DI.
                        browserAPI.setCurrentUser(freshUser);
                        renderAuthHeader(); // Re-render again if user details were fetched now
                        notify.info(`[App] Fresh user details fetched and applied. User ID: ${freshUser.id}`);
                    } else {
                        notify.warn('[App] User authenticated, but failed to fetch user details.');
                    }
                } catch (fetchErr) {
                    notify.error('[App] Error fetching user details after login.', { error: fetchErr });
                }
            }
            toggleElement(APP_CONFIG.SELECTORS.LOGIN_REQUIRED_MESSAGE, false);
            // Ensure projectDashboard (pd) is resolved before calling showProjectList
            if (pd && typeof pd.showProjectList === 'function') {
                pd.showProjectList();
            } else {
                notify.error('[App] projectDashboard or showProjectList not available after login.', { pdExists: !!pd, canShowList: typeof pd?.showProjectList === 'function' });
            }
            // pm?.loadProjects?.('all').catch(err => notify.error('[App] loadProjects failed after login', { error: err })); // Redundant call removed
            handleNavigationChange({ forceListView: true }); // Re-evaluate navigation, forcing list view
        } else if (!appState.isAuthenticated && prevAuth) {
            // Just Logged OUT
            notify.debug('[App] User logged out -> clearing data/UI.');
            toggleElement(APP_CONFIG.SELECTORS.LOGIN_REQUIRED_MESSAGE, true);
            if (pm) pm.currentProject = null; // Clear current project in ProjectManager
            st?.removeItem?.('selectedProjectId');
            pd?.showLoginRequiredMessage?.();
            sb?.clear?.();
            cm?.cleanup?.(); // Use cleanup if available, otherwise clear
            lastHandledProj = null;
            lastHandledChat = null;
            handleNavigationChange({ forceListView: true }); // Re-evaluate navigation, forcing list view
        }
    })();
}

// ---------------------------------------------------------------------------
// 13) Chat manager on demand
// ---------------------------------------------------------------------------
function createOrGetChatManager() {
    let cm = DependencySystem.modules.get('chatManager');
    if (cm) return cm;

    const authModule = DependencySystem.modules.get('auth');

    cm = createChatManager({
        DependencySystem,
        apiRequest,
        auth: authModule,
        eventHandlers,
        // Inject modelConfig and projectDetailsComponent for ChatManager
        modelConfig: DependencySystem.modules.get('modelConfig'),
        projectDetailsComponent: DependencySystem.modules.get('projectDetailsComponent'),
        app,
        domAPI,
        navAPI: {
            getSearch: () => browserAPI.getLocation().search,
            getHref: () => browserAPI.getLocation().href,
            pushState: (url, title = '') => browserAPI.getHistory().pushState({}, title, url),
            getPathname: () => browserAPI.getLocation().pathname
        },
        isValidProjectId,             // util real de globalUtils
        isAuthenticated: () => authModule?.isAuthenticated?.() || false,
        DOMPurify: DependencySystem.modules.get('sanitizer'),
        apiEndpoints: DependencySystem.modules.get('apiEndpoints'),
        notificationHandler: notify,
        notify,                // ← pasa el DI real
        errorReporter: DependencySystem.modules.get('errorReporter')
    });
    DependencySystem.register('chatManager', cm);
    return cm;
}

// ---------------------------------------------------------------------------
// 14) Error handling, spinner toggling, etc.
// ---------------------------------------------------------------------------
function handleInitError(error) {
    appState.initialized = false;
    appState.initializing = false;
    appState.currentPhase = 'failed_init';

    const errorReporter = DependencySystem.modules.get('errorReporter');
    maybeCapture(errorReporter, error, {
        tags: { module: 'app', method: 'init', phase: appState.currentPhase }
    });
    notify.error(`Application failed to start: ${error?.message}`, { error });
    toggleLoadingSpinner(false);
}

function toggleLoadingSpinner(show) {
    toggleElement(APP_CONFIG.SELECTORS?.APP_LOADING_SPINNER, show);
}


function isDocumentReady() {
    const doc = domAPI.getDocument();
    return doc.readyState === 'interactive' || doc.readyState === 'complete';
}

// A small helper for very short delays

// ---------------------------------------------------------------------------
// 15) Export or attach init for external usage
// ---------------------------------------------------------------------------
const w = browserAPI.getWindow();
// If your app requires a global handle:
w.initializeApp = init; // or you can skip and just rely on ES module usage

// By default, if DOM is ready, start init
if (isDocumentReady()) {
    init();
} else {
    eventHandlers.trackListener(
        domAPI.getDocument(),
        'DOMContentLoaded',
        () => init(),
        { once: true, description: 'Initial DOMContentLoaded -> init app', context: 'app' }
    );
}
