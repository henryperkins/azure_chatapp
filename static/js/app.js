/**
 * app.js – Main application orchestration.
 * Coordinates module wiring, initialization phases, and DI usage.
 */

import { APP_CONFIG } from './appConfig.js';
import { createDomAPI } from './utils/domAPI.js';             // your abstracted DOM helpers
import { createBrowserAPI } from './utils/globalUtils.js'; // for SSR-safe references to window, location, etc.
import { createBrowserService } from './utils/browserService.js';
import { createNotify } from './utils/notify.js';
import { createSentryManager } from './sentry-init.js';
import {
  createApiClient,
  shouldSkipDedup,
  stableStringify,
  normaliseUrl,
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
import { createKnowledgeBaseComponent } from './knowledgeBaseComponent.js';

import MODAL_MAPPINGS from './modalConstants.js';
import { FileUploadComponent } from './FileUploadComponent.js';
// Removed import for ./auth/authUI.js (now obsolete)

// Back-compat: si la clase aún no define validateUUID, añade alias al helper global
// (Removed: ProjectDetailsComponent is not defined. This block is obsolete.)

// Example: For consistent message durations, etc.

// ---------------------------------------------------------------------------
// 1) Create DI-based references: browserAPI, domAPI, notify, etc.
// ---------------------------------------------------------------------------
const browserAPI = createBrowserAPI();                   // SSR-safe checks
const domAPI = createDomAPI({
    documentObject: browserAPI.getDocument(),
    windowObject: browserAPI.getWindow()
});
const browserServiceInstance = createBrowserService({
    windowObject: browserAPI.getWindow()
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
let notify = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  apiError: () => {}
};

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

// Register a few basic items
DependencySystem.register('domAPI', domAPI);
DependencySystem.register('browserAPI', browserAPI);
DependencySystem.register('browserService', browserServiceInstance);
DependencySystem.register('storage', browserServiceInstance);

// Register sanitizer (DOMPurify) for DI
const sanitizer = (typeof window !== 'undefined' && window.DOMPurify) ? window.DOMPurify : undefined;
if (!sanitizer) {
    throw new Error('[App] DOMPurify sanitizer not found. Please ensure DOMPurify is loaded before app.js.');
}
DependencySystem.register('sanitizer', sanitizer);

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

// ---------------------------------------------------------------------------
// 3) Create the event handlers (now notify is initialized)
// ---------------------------------------------------------------------------
const eventHandlers = createEventHandlers({
    DependencySystem,
    domAPI,
    browserService: browserServiceInstance,
    notify
});
DependencySystem.register('eventHandlers', eventHandlers);

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

// Late-bind the real notify into eventHandlers so all new events use the correct notifier
eventHandlers.setNotifier?.(notify);

// ---------------------------------------------------------------------------
// Global error catch (fail-fast at window level)
if (typeof window !== "undefined") {
    window.addEventListener('error',  e =>
        notify?.error?.(e.message, { source:'global' })
    );
    window.addEventListener('unhandledrejection', e =>
        notify?.error?.(e.reason?.message || 'unhandled rejection', { source:'global' })
    );
}

// ---------------------------------------------------------------------------
// 5) Create the unified apiRequest using our new “createApiClient”
// ---------------------------------------------------------------------------
const apiRequest = createApiClient({
    APP_CONFIG,
    globalUtils: {
        shouldSkipDedup,
        stableStringify,
        normaliseUrl,
        isAbsoluteUrl
    },
    notificationHandler: notify,
    getAuthModule: () => DependencySystem.modules.get('auth'),
    browserAPI
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
DependencySystem.register('app', app);

// ---------------------------------------------------------------------------
// 7) Main init
// ---------------------------------------------------------------------------
export async function init() {
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
            if (user) {
                currentUser = user;
                browserAPI.setCurrentUser(user);
                DependencySystem.register('currentUser', user);
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
        domAPI.dispatchEvent(browserAPI.getDocument(), new CustomEvent('appInitialized', { detail: { success: true } }));
        return true;
    } catch (err) {
        notify.error(`[App] Initialization failed: ${err?.message}`, { error: err });
        handleInitError(err);
        domAPI.dispatchEvent(browserAPI.getDocument(), new CustomEvent('appInitialized', { detail: { success: false, error: err } }));
        return false;
    } finally {
        _globalInitInProgress = false;
        appState.initializing = false;
        toggleLoadingSpinner(false);
        appState.currentPhase = appState.initialized ? 'initialized_idle' : 'failed_idle';
    }
}

// ---------------------------------------------------------------------------
// 8) Core systems initialization
// ---------------------------------------------------------------------------
async function initializeCoreSystems() {
    try {
        notify.debug('[App] Initializing core systems...');
        // Ensure DOM is ready using shared util (also future-proofs for SSR tests)
        await waitForDepsAndDom({ DependencySystem });

        // Initialize modal manager
        const modalManager = createModalManager({
            domAPI,
            browserService: browserServiceInstance,
            eventHandlers,
            DependencySystem,
            modalMapping: MODAL_MAPPINGS,
            notify
        });
        DependencySystem.register('modalManager', modalManager);

        // Auth
        const authModule = createAuthModule({
            apiRequest,
            notify,
            eventHandlers,
            domAPI,
            sanitizer: DependencySystem.modules.get('sanitizer'),
            modalManager,
            apiEndpoints: DependencySystem.modules.get('apiEndpoints')
        });
        DependencySystem.register('auth', authModule);

        // Ensure chatManager is available prior to projectManager creation
        const chatManager = createOrGetChatManager();

        // Project manager
        const projectManager = createProjectManager({
            DependencySystem,
            chatManager,
            app,
            notify,
            apiEndpoints: DependencySystem.modules.get('apiEndpoints'),
            storage: DependencySystem.modules.get('storage'),
            listenerTracker: {
                add: (...args) => eventHandlers.trackListener(...args),
                remove: (...args) => eventHandlers.cleanupListeners(...args)
            }
        });
        DependencySystem.register('projectManager', projectManager);

        // Project modal
        const projectModal = createProjectModal({
            DependencySystem,
            eventHandlers,
            notify,
            domAPI,
            browserService: browserServiceInstance
        });
        DependencySystem.register('projectModal', projectModal);

        // Wait for modals load signal
        await new Promise((res) => {
            eventHandlers.trackListener(
                domAPI.getDocument(),
                'modalsLoaded',
                () => res(true),
                { once: true, description: 'modalsLoaded for app init' }
            );
        });

        // No longer initializing authUI—auth logic is now entirely internal to auth.js


        if (modalManager.init) modalManager.init();

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
                { description: '[App] AuthBus authStateChanged' }
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
        const authContainer = domAPI.getElementById('authContainer');
        // Create or get headerLoginForm
        let headerLoginForm = domAPI.getElementById('headerLoginForm');
        if (!headerLoginForm && authContainer) {
            headerLoginForm = domAPI.createElement('div');
            domAPI.setAttribute(headerLoginForm, 'id', 'headerLoginForm');
            domAPI.addClass(headerLoginForm, 'w-full');
            domAPI.insertBefore(authContainer, headerLoginForm, authBtn || userMenu || null);
        }

        // Sync visibility and show login form when not authenticated
        if (isAuth) {
            if (authBtn) domAPI.addClass(authBtn, 'hidden');
            if (userMenu) domAPI.removeClass(userMenu, 'hidden');
            if (headerLoginForm) {
                domAPI.addClass(headerLoginForm, 'hidden');
                domAPI.setInnerHTML(headerLoginForm, ''); // Clear any form
            }
        } else {
            if (authBtn) domAPI.addClass(authBtn, 'hidden');
            if (userMenu) domAPI.addClass(userMenu, 'hidden');
            if (headerLoginForm) {
                domAPI.removeClass(headerLoginForm, 'hidden');
                // Build login form markup
                domAPI.setInnerHTML(headerLoginForm, `
                  <form id="headerLoginActualForm" class="flex items-center gap-2" autocomplete="on">
                    <input id="headerLoginUsername" name="username" type="text" required autocomplete="username"
                      class="input input-sm input-bordered w-28 sm:w-32" placeholder="Username/Email" />
                    <input id="headerLoginPassword" name="password" type="password" required autocomplete="current-password"
                      class="input input-sm input-bordered w-24 sm:w-28" placeholder="Password" />
                    <button id="headerLoginSubmit" type="submit"
                      class="btn btn-primary btn-sm min-w-[44px] min-h-[32px]">Login</button>
                  </form>
                `);
                // Setup form handler with DI/eventHandlers
                const loginForm = domAPI.getElementById('headerLoginActualForm');
                if (loginForm) {
                    eventHandlers.trackListener(
                        loginForm,
                        'submit',
                        async (e) => {
                            domAPI.preventDefault(e);
                            const username = domAPI.getValue(domAPI.getElementById('headerLoginUsername'))?.trim();
                            const password = domAPI.getValue(domAPI.getElementById('headerLoginPassword'));
                            if (!username || !password) {
                                notify.warn('Username and password required', { module: 'app', source: 'headerLoginForm' });
                                return;
                            }
                            try {
                                await authMod?.login?.({ username, password });
                                notify.success('Logged in successfully', { module: 'app', source: 'headerLoginForm' });
                            } catch (err) {
                                notify.error('Login failed', { module: 'app', source: 'headerLoginForm', error: err });
                            }
                        },
                        { passive: false, description: 'Header login form submit', context: 'auth', module: 'app' }
                    );
                }
            }
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
                { description: 'Auth logout button' }
            );
        }
    } catch (err) {
        notify.error('[App] Error rendering auth header.', { error: err });
    }
}

async function fetchCurrentUser() {
    try {
        const authModule = DependencySystem.modules.get('auth');
        if (authModule?.getCurrentUserAsync) {
            return await authModule.getCurrentUserAsync();
        }
        if (authModule?.getCurrentUser) {
            return authModule.getCurrentUser();
        }
        return null;
    } catch (error) {
        notify.error('[App] Failed to fetch current user', { error });
        return null;
    }
}

// ---------------------------------------------------------------------------
// 10) UI components
// ---------------------------------------------------------------------------
let _uiInitialized = false;

async function initializeUIComponents() {
    try {
        if (_uiInitialized) {
            notify.warn('[App] initializeUIComponents called again; skipping.');
            return;
        }
        notify.debug('[App] Initializing UI components...');

        // Ensure DOM element for ProjectList exists before continuing.
        await waitForDepsAndDom({
            DependencySystem,
            domSelectors: ['#projectList']
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

        const modelConfigInstance = createModelConfig({
            DependencySystem, notify
        });
        DependencySystem.register('modelConfig', modelConfigInstance);

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
                    browserAPI.getHistory().pushState({}, '', url);
                    domAPI.dispatchEvent(browserAPI.getWindow(), new Event('locationchange'));
                },
                getURL: () => browserAPI.getLocation().href
            },
            notify,
            storage: DependencySystem.modules.get('storage'),
            sanitizer: DependencySystem.modules.get('sanitizer'),
            domAPI
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

        const sidebarInstance = createSidebar({
            DependencySystem,
            eventHandlers,
            app,
            projectDashboard: projectDashboardInstance,
            projectManager,
            notify,
            storageAPI: DependencySystem.modules.get('storage'),
            domAPI,
            viewportAPI: { getInnerWidth: () => browserAPI.getInnerWidth() }
        });
        DependencySystem.register('sidebar', sidebarInstance);

        const knowledgeBaseComponentInstance = createKnowledgeBaseComponent({
            DependencySystem,
            apiRequest,
            auth: authModule,
            projectManager,
            uiUtils: {}, // pass shortcut utils as needed
            sanitizer: DependencySystem.modules.get('sanitizer')
        });
        DependencySystem.register('knowledgeBaseComponent', knowledgeBaseComponentInstance);

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
                { description: 'locationchange -> handleNavigationChange' }
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

async function handleNavigationChange() {
    try {
        if (!appState.initialized) {
            // If still not ready, short-circuit or wait briefly
            if (appState.initializing) {
                await new Promise(r => browserAPI.requestAnimationFrame(r)); // yield to browser; replaced delay(150)
                if (!appState.initialized) {
                    notify.warn("[App] handleNavigationChange: Aborted, initialization didn't complete in time.");
                    return;
                }
            } else {
                notify.warn("[App] handleNavigationChange: Aborted, application not initialized.");
                return;
            }
        }
        notify.debug(`[App] Navigation changed -> ${browserAPI.getLocation().href}`);

        let projectDashboard;
        try {
            projectDashboard = await DependencySystem.waitFor('projectDashboard', null, APP_CONFIG.TIMEOUTS?.DEPENDENCY_WAIT);
        } catch (e) {
            notify.error('[App] Project Dashboard unavailable for navigation.', { error: e });
            toggleElement(APP_CONFIG.SELECTORS.APP_FATAL_ERROR, true);
            return;
        }

        const projectId = browserServiceInstance.getSearchParam('project');
        const chatId    = browserServiceInstance.getSearchParam('chatId');

        if (projectId === lastHandledProj && chatId === lastHandledChat) {
            notify.debug('[App] Same project/chat; skipping re-load.');
            return;
        }
        lastHandledProj = projectId;
        lastHandledChat = chatId;

        if (!appState.isAuthenticated) {
            notify.debug('[App] Not authenticated -> show login required');
            projectDashboard.showLoginRequiredMessage?.();
            return;
        }
        toggleElement(APP_CONFIG.SELECTORS.LOGIN_REQUIRED_MESSAGE, false);

        try {
            const pm = await DependencySystem.waitFor('projectManager', null, APP_CONFIG.TIMEOUTS?.DEPENDENCY_WAIT);
            if (projectId) {
                await pm.loadProjectDetails(projectId);
                await projectDashboard.showProjectDetails(projectId);

                if (chatId) {
                    const ok = await app.navigateToConversation(chatId);
                    if (!ok) notify.warn('[App] Chat load failed from navigation, chatId:', { chatId });
                }
            } else {
                await projectDashboard.showProjectList();
            }
        } catch (navErr) {
            notify.error('[App] Error during navigation logic.', { error: navErr });
            projectDashboard.showProjectList?.().catch(fbErr => {
                notify.error('[App] Fallback to showProjectList also failed.', { error: fbErr });
            });
        }
    } catch (err) {
        const errorReporter = DependencySystem.modules.get('errorReporter');
        maybeCapture(errorReporter, err, {
            module: 'app',
            method: 'handleNavigationChange'
        });
        notify.error('[App] Navigation change handler failed.', {
            error: err,
            module: 'app',
            source: 'handleNavigationChange'
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
    if (newAuthState === appState.isAuthenticated) return;

    const prev = appState.isAuthenticated;
    appState.isAuthenticated = newAuthState;
    if (user) currentUser = user;

    notify.info(`[App] Auth state changed -> ${appState.isAuthenticated}`);
    renderAuthHeader();

    (async () => {
        const pm = DependencySystem.modules.get('projectManager');
        const pd = DependencySystem.modules.get('projectDashboard');
        const sb = DependencySystem.modules.get('sidebar');
        const cm = DependencySystem.modules.get('chatManager');
        const st = DependencySystem.modules.get('storage');
        if (appState.isAuthenticated && !prev) {
            // Logged IN
            notify.debug('[App] User logged in -> refreshing data/UI.');
            toggleElement(APP_CONFIG.SELECTORS.LOGIN_REQUIRED_MESSAGE, false);
            pd?.showProjectList?.();
            pm?.loadProjects?.('all').catch(err => notify.error('[App] loadProjects failed after login', { error: err }));
            handleNavigationChange();
        } else if (!appState.isAuthenticated && prev) {
            // Logged OUT
            notify.debug('[App] User logged out -> clearing data/UI.');
            toggleElement(APP_CONFIG.SELECTORS.LOGIN_REQUIRED_MESSAGE, true);
            pm.currentProject = null;
            st?.removeItem?.('selectedProjectId');
            pd?.showLoginRequiredMessage?.();
            sb?.clear?.();
            cm?.clear?.();
            lastHandledProj = null;
            lastHandledChat = null;
            handleNavigationChange();
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
        notificationHandler: notify
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
        { once: true, description: 'Initial DOMContentLoaded -> init app' }
    );
}
