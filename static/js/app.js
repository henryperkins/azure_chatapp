/**
 * app.js - Main application orchestration.
 *
 * ╔════════════════ WARNING: BOOTSTRAP EXCEPTION ════════════════╗
 * ║ This is the ONLY JS/TS module permitted to contain          ║
 * ║ top-level code, side effects, and initialization logic.     ║
 * ║ ALL other modules MUST export factories with no import-time ║
 * ║ effects, per .clinerules/custominstructions.md.             ║
 * ║ This exception is intentional for app.js as Root Orchestrator║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * Coordinates module wiring, initialization phases, and DI usage.
 */

import { APP_CONFIG } from './appConfig.js';
import { createDomAPI } from './utils/domAPI.js';
import { createBrowserService, normaliseUrl } from './utils/browserService.js';
import { createDomReadinessService } from './utils/domReadinessService.js';
import { createApiClient } from './utils/apiClient.js';
import { createHtmlTemplateLoader } from './utils/htmlTemplateLoader.js';
import { createCoreInitializer } from './init/coreInit.js';
import { createAuthInitializer } from './init/authInit.js';
import { createAppStateManager } from './init/appState.js';
import { createErrorInitializer } from './init/errorInit.js';

import {
  shouldSkipDedup,
  stableStringify,
  isAbsoluteUrl,
  isValidProjectId,
  toggleElement
} from './utils/globalUtils.js';

import { createEventHandlers } from './eventHandler.js';
import { createAuthModule } from './auth.js';
import { createChatManager } from './chat.js';
import { createProjectManager } from './projectManager.js';
import { createProjectModal, createModalManager } from './modalManager.js';
import { createChatExtensions } from './chatExtensions.js';
import { createModelConfig } from './modelConfig.js';
import { createProjectDashboardUtils } from './projectDashboardUtils.js';
import { createProjectDashboard } from './projectDashboard.js';
import { createProjectListComponent } from './projectListComponent.js';
import { createProjectDetailsComponent } from './projectDetailsComponent.js';
import { createSidebar } from './sidebar.js';
import { createUiRenderer } from './uiRenderer.js';
import { createKnowledgeBaseComponent } from './knowledgeBaseComponent.js';
import { createAccessibilityEnhancements } from './accessibility-utils.js';
import { createNavigationService } from './navigationService.js';
import { createProjectDetailsEnhancements } from './project-details-enhancements.js';
import { createChatUIEnhancements } from './chatUIEnhancements.js';
import { createTokenStatsManager } from './tokenStatsManager.js';

import MODAL_MAPPINGS from './modalConstants.js';
import { createFileUploadComponent } from './FileUploadComponent.js';

// ---------------------------------------------------------------------------
// UI helpers for KnowledgeBaseComponent
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
  fileIcon: (type = '') => {
    const map = {
      pdf: '📄',
      doc: '📄',
      docx: '📄',
      csv: '🗒️',
      json: '🗒️',
      png: '🖼️',
      jpg: '🖼️',
      jpeg: '🖼️'
    };
    return map[(type || '').toLowerCase()] ?? '📄';
  }
};

// ---------------------------------------------------------------------------
// 1) Create base services
// ---------------------------------------------------------------------------
const browserServiceInstance = createBrowserService({
  windowObject: (typeof window !== 'undefined') ? window : undefined
});
const browserAPI = browserServiceInstance;

// ---------------------------------------------------------------------------
// 2) Initialize DependencySystem (moved up, before first use)
// ---------------------------------------------------------------------------
const DependencySystem = browserAPI.getDependencySystem();
if (!DependencySystem?.modules?.get) {
  throw new Error('[App] DependencySystem not present - bootstrap aborted');
}

// Logger: Import first for early DI registration
import { createLogger } from './logger.js';

// PHASE 1: Create a basic logger for early DI (no authModule yet)
let logger = createLogger({
  context: 'App',
  debug: APP_CONFIG && APP_CONFIG.DEBUG === true,
  minLevel: APP_CONFIG.LOGGING?.MIN_LEVEL ?? 'info',
  fetcher: browserAPI.getWindow()?.fetch?.bind?.(browserAPI.getWindow()) || null,
  enableServer: false // Prevent backend POSTs before authModule is available
});
DependencySystem.register('logger', logger);

// Dedicated App Event Bus
const AppBus = new EventTarget();
DependencySystem.register('AppBus', AppBus);

// ---------------------------------------------------------------------------
// Early 'app:ready' dispatch helper
// ---------------------------------------------------------------------------
let _appReadyDispatched = false;
/**
 * fireAppReady – Emits the global "app:ready" event exactly once.
 * Subsequent calls are ignored.
 *
 * @param {boolean} success - true if init succeeded.
 * @param {Error|null} error - optional error object on failure.
 */
function fireAppReady(success = true, error = null) {
  if (_appReadyDispatched) return;
  _appReadyDispatched = true;
  // Register 'app' in DI once (skip if already present)
  if (
    success &&
    DependencySystem &&
    typeof DependencySystem.register === "function" &&
    !(DependencySystem.modules?.has?.('app'))
  ) {
    DependencySystem.register('app', app);
  }
  const detail = success ? { success } : { success, error };
  AppBus.dispatchEvent(new CustomEvent('app:ready', { detail }));
  domAPI.getDocument()?.dispatchEvent(new CustomEvent('app:ready', { detail }));
  DependencySystem.modules.get('logger')?.log('[fireAppReady] dispatched', { success, error, context: 'app' });
}

// ──  initialise sanitizer FIRST ──────────────────────────────────
let sanitizer = browserAPI.getWindow()?.DOMPurify;
if (!sanitizer) {
  throw new Error('[App] DOMPurify not found - aborting bootstrap for security reasons.');
}
DependencySystem.register('sanitizer', sanitizer);
DependencySystem.register('domPurify', sanitizer);  // legacy alias

// ──  now it is safe to create domAPI  ────────────────────────────
const domAPI = createDomAPI({
  documentObject: browserAPI.getDocument(),
  windowObject: browserAPI.getWindow(),
  debug: APP_CONFIG.DEBUG === true,
  logger,
  sanitizer                      // ← now defined
});

// ---------------------------------------------------------------------------
// 3) Register base services
// ---------------------------------------------------------------------------
DependencySystem.register('domAPI', domAPI);

const errorReporter =
  { report: (...args) => logger.error('[ErrorReporterStub]', ...args, { context: 'app:ErrorReporterStub' }) };
DependencySystem.register('errorReporter', errorReporter);

// ---------------------------------------------------------------------------
// The app variable is already declared and registered above (before eventHandlers)

let app = {};
// Early DI-registration so any later waitFor('app') succeeds
DependencySystem.register('app', app);
const eventHandlers = createEventHandlers({
  app,
  DependencySystem,
  domAPI,
  browserService: browserServiceInstance,
  APP_CONFIG,
  sanitizer,
  logger,          // Pass logger dependency explicitly
  errorReporter    // Pass errorReporter dependency explicitly
});
DependencySystem.register('eventHandlers', eventHandlers);

const domReadinessService = createDomReadinessService({
  DependencySystem,
  domAPI,
  browserService: browserServiceInstance,
  eventHandlers, // Inject eventHandlers as required by domReadinessService
  APP_CONFIG
});
DependencySystem.register('domReadinessService', domReadinessService);

// Wire circular dependency with setter (post-construction)
eventHandlers.setDomReadinessService(domReadinessService);

DependencySystem.register('browserAPI', browserAPI);
DependencySystem.register('browserService', browserServiceInstance);
DependencySystem.register('storage', browserServiceInstance);
DependencySystem.register('uiUtils', uiUtils);

const globalUtils = {
  isValidProjectId,
  isAbsoluteUrl,
  normaliseUrl,
  shouldSkipDedup,
  stableStringify
};
DependencySystem.register('globalUtils', globalUtils);

// (NO duplicate sanitizer declaration/registration here)
DependencySystem.register('FileUploadComponent', createFileUploadComponent);

// Register apiEndpoints
const apiEndpoints = APP_CONFIG?.API_ENDPOINTS || {
  PROJECTS: '/api/projects/',
  AUTH_CSRF: '/api/auth/csrf',
  AUTH_LOGIN: '/api/auth/login',
  AUTH_LOGOUT: '/api/auth/logout',
  AUTH_REGISTER: '/api/auth/register',
  AUTH_VERIFY: '/api/auth/verify',
  AUTH_REFRESH: '/api/auth/refresh',
  CONVOS: '/api/projects/{id}/conversations',
  PROJECT_CONVERSATIONS_URL_TEMPLATE: '/api/projects/{id}/conversations',
  CONVERSATIONS: (projectId) => `/api/projects/${projectId}/conversations`,
  CONVERSATION: (projectId, conversationId) => `/api/projects/${projectId}/conversations/${conversationId}`,
  MESSAGES: (projectId, conversationId) => `/api/projects/${projectId}/conversations/${conversationId}/messages`
};
DependencySystem.register('apiEndpoints', apiEndpoints);

const globalConsole = (typeof console !== 'undefined') ? console : {};
// (Removed old appLogger: replaced by DI-registered logger above)

// ---------------------------------------------------------------------------
// 4) Early app module (using factory)
// ---------------------------------------------------------------------------
const appModule = createAppStateManager({ DependencySystem, logger });
DependencySystem.register('appModule', appModule);

// ---------------------------------------------------------------------------
// The app variable is already declared and registered above (before eventHandlers)

// ---------------------------------------------------------------------------
// 7.5) Create API client
// ---------------------------------------------------------------------------
const apiRequest = createApiClient({
  APP_CONFIG,
  globalUtils: { shouldSkipDedup, stableStringify, normaliseUrl, isAbsoluteUrl },
  getAuthModule: () => DependencySystem.modules.get('auth'),
  browserService: browserServiceInstance
});
DependencySystem.register('apiRequest', apiRequest);

// ---------------------------------------------------------------------------
// Accessibility enhancements
// ---------------------------------------------------------------------------
const accessibilityUtils = createAccessibilityEnhancements({
  domAPI,
  eventHandlers,
  logger,
  domReadinessService
});
DependencySystem.register('accessibilityUtils', accessibilityUtils);

// ---------------------------------------------------------------------------
// 10) Create navigation service
// ---------------------------------------------------------------------------
let navigationService = createNavigationService({
  domAPI,
  browserService: browserServiceInstance,
  DependencySystem,
  eventHandlers
});
DependencySystem.register('navigationService', navigationService);

// ---------------------------------------------------------------------------
// 11) Create HTML template loader
// ---------------------------------------------------------------------------
const htmlTemplateLoader = createHtmlTemplateLoader({
  DependencySystem,
  domAPI,
  eventHandlers,          // ← add this line
  sanitizer,
  // HtmlTemplateLoader needs the real fetch so it receives a Response object,
  // not the parsed body that apiRequest returns.
  apiClient: {
    fetch: (...args) => {
      const win = browserAPI.getWindow();
      if (!win?.fetch) {
        throw new Error('[app] browserAPI.getWindow().fetch is not available');
      }
      return win.fetch(...args);
    }
  },
  timerAPI: {
    setTimeout: (...args) => browserAPI.getWindow().setTimeout(...args),
    clearTimeout: (...args) => browserAPI.getWindow().clearTimeout(...args)
  }
});
DependencySystem.register('htmlTemplateLoader', htmlTemplateLoader);

// --- Deferred modals.html injection (now DOM-readiness-safe) ---
domReadinessService
  .dependenciesAndElements({
    domSelectors: ['#modalsContainer'],
    timeout: APP_CONFIG.TIMEOUTS?.COMPONENT_ELEMENTS_READY ?? 8000,
    context: 'app:injectModalsHtml'
  })
  .then(() =>
    htmlTemplateLoader.loadTemplate({
      url: '/static/html/modals.html',
      containerSelector: '#modalsContainer',
      eventName: 'modalsLoaded'
    })
  )
  .catch(err =>
    logger.error('[app.js][injectModalsHtml]', err, { context: 'app:injectModalsHtml' })
  );

// ---------------------------------------------------------------------------
// 12) app object & top-level state
// ---------------------------------------------------------------------------
let currentUser = null; // This local currentUser is used by renderAuthHeader and fetchCurrentUser.
// It should be kept in sync with appModule.state.currentUser.

// The local appState variable has been removed. Its properties are merged into appModule.state.
// appModule.state is now the single source of truth for these flags.

let _globalInitCompleted = false;
let _globalInitInProgress = false;

/* Enrich the stub "app" (registered earlier) with its real API */

// Centralized current project state and API
let currentProject = null; // NEW: THE single source of truth

Object.assign(app, {
  getProjectId: () => {
    const { search } = browserAPI.getLocation();
    return new URLSearchParams(search).get('project');
  },
  getCurrentProject: () => {
    return currentProject ? JSON.parse(JSON.stringify(currentProject)) : null; // always return copy
  },
  setCurrentProject: (project) => {
    if (!project || !project.id) return;
    const previous = currentProject;
    currentProject = project;
    // optional: emit an event for listeners who care about project changes
    const appBus = DependencySystem.modules.get('AppBus');
    if (appBus && typeof appBus.dispatchEvent === 'function') {
      appBus.dispatchEvent(new CustomEvent('currentProjectChanged', {
        detail: { project, previousProject: previous }
      }));
    }
    // Do not re-register in DependencySystem. Only the initial registration (null) at startup is allowed.
    return project;
  },
  navigateToConversation: async (chatId) => {
    const chatMgr = DependencySystem.modules.get('chatManager');
    if (chatMgr?.loadConversation) {
      return chatMgr.loadConversation(chatId);
    }
    return false;
  },
  validateUUID: (id) => isValidProjectId(id),
  // Instead of directly mutating app.state, call the "auth" setter in appModule
  setCurrentUser: (user) => {
    const appModuleRef = DependencySystem.modules.get('appModule');
    appModuleRef?.setAuthState({
      currentUser: user // do not mutate app.state directly
    });
  }
});

// Stub was already registered earlier; no need to re-register.
app.DependencySystem = DependencySystem;
app.apiRequest = apiRequest;
app.state = appModule.state; // Point app.state to the single source of truth in appModule

// Force currentUser to null in DI
DependencySystem.register('currentUser', null);

// ---------------------------------------------------------------------------
// Utility functions (moved up)
// ---------------------------------------------------------------------------
function toggleLoadingSpinner(show) {
  const spinner = domAPI.getElementById('appLoadingSpinner');
  if (spinner) {
    if (show) {
      domAPI.removeClass(spinner, 'hidden');
    } else {
      domAPI.addClass(spinner, 'hidden');
    }
  }
}
function createOrGetChatManager() {
  const existing = DependencySystem.modules.get('chatManager');
  if (existing) return existing;

  const authModule = DependencySystem.modules.get('auth');

  const cm = createChatManager({
    DependencySystem,
    apiRequest,
    auth: authModule,
    eventHandlers,
    modelConfig: DependencySystem.modules.get('modelConfig'),
    projectDetailsComponent: DependencySystem.modules.get('projectDetailsComponent'),
    app,
    domAPI,
    domReadinessService,
    logger,
    navAPI: {
      getSearch: () => browserAPI.getLocation().search,
      getHref: () => browserAPI.getLocation().href,
      // Sólo modifica la barra de direcciones; no dispares navegación
      pushState: (url, title = "") =>
        browserAPI.pushState({}, title, url),
      getPathname: () => browserAPI.getLocation().pathname
    },
    isValidProjectId,
    isAuthenticated: () => !!authModule?.isAuthenticated?.(),
    DOMPurify: DependencySystem.modules.get('sanitizer'),
    apiEndpoints,
    APP_CONFIG                 // ← NEW injection
  });

  DependencySystem.register('chatManager', cm);
  return cm;
}

/**
 * safeHandler - Ensures all event handler exceptions are logged via DI logger.
 * Always use for user-initiated/UI handlers, with context tagging.
 */
function safeHandler(handler, description) {
  // logger is guaranteed in DI for all app modules
  const logger = DependencySystem.modules.get && DependencySystem.modules.get('logger');
  return (...args) => {
    try {
      return handler(...args);
    } catch (err) {
      if (logger && typeof logger.error === "function") {
        logger.error(
          `[app.js][${description}]`,
          err && err.stack ? err.stack : err,
          { context: description || "app.js" }
        );
      }
      throw err;
    }
  };
}

// ---------------------------------------------------------------------------
// Create auth initializer (after safeHandler is defined)
// ---------------------------------------------------------------------------
const authInit = createAuthInitializer({
  DependencySystem,
  domAPI,
  eventHandlers,
  logger,
  sanitizer,
  safeHandler,
  domReadinessService,
  APP_CONFIG
});
DependencySystem.register('authInit', authInit);

// ---------------------------------------------------------------------------
// Create error initializer (after safeHandler is defined)
// ---------------------------------------------------------------------------
const errorInit = createErrorInitializer({
  DependencySystem,
  browserService: browserServiceInstance,
  eventHandlers,
  logger,
  safeHandler
});
DependencySystem.register('errorInit', errorInit);


/* ---------------------------------------------------------------------------
   Utility functions required by init and other top-level logic
--------------------------------------------------------------------------- */
async function safeInit(instance, name, methodName) {
  const logger = DependencySystem.modules.get('logger');
  if (!instance) {
    logger?.warn(`[safeInit] Instance ${name} is null/undefined. Cannot call ${methodName}.`, { context: `app:safeInit:${name}` });
    return false;
  }
  if (typeof instance[methodName] !== 'function') {
    logger?.warn(`[safeInit] Method ${methodName} not found on ${name}.`, { context: `app:safeInit:${name}` });
    return false;
  }
  try {
    const result = await instance[methodName]();
    return result === undefined ? true : !!result;
  } catch (err) {
    logger?.error(`[safeInit] Error during ${name}.${methodName}()`, err, { context: `app:safeInit:${name}:${methodName}` });
    throw err;
  }
}

async function fetchCurrentUser() {
  try {
    const authModule = DependencySystem.modules.get('auth');
    if (!authModule) {
      return null;
    }

    if (authModule.fetchCurrentUser) {
      const userObj = await authModule.fetchCurrentUser();
      if (userObj?.id) {
        return userObj;
      }
    }

    if (authModule.getCurrentUserObject) {
      const userObjFromGetter = authModule.getCurrentUserObject();
      if (userObjFromGetter?.id) {
        return userObjFromGetter;
      }
    }

    if (authModule.getCurrentUserAsync) {
      const userObjAsync = await authModule.getCurrentUserAsync();
      if (userObjAsync?.id) {
        return userObjAsync;
      }
    }

    return null;
  } catch (error) {
    logger.error('[fetchCurrentUser]', error, { context: 'app:fetchCurrentUser' });
    return null;
  }
}

function setupChatInitializationTrigger() {
  const projectManager = DependencySystem.modules.get('projectManager');
  const chatManager = DependencySystem.modules.get('chatManager');
  const auth = DependencySystem.modules.get('auth');

  if (!projectManager || !chatManager || !auth) {
    return;
  }

  eventHandlers.trackListener(
    domAPI.getDocument(),
    'projectSelected',
    safeHandler(async (e) => {
      const projectId = e?.detail?.projectId;
      if (!projectId) return;

      if (auth.isAuthenticated() && chatManager?.initialize) {
        try {
          await chatManager.initialize({
            projectId,
            containerSelector: "#projectChatContainer",
            messageContainerSelector: "#projectChatMessages",
            inputSelector: "#projectChatInput",
            sendButtonSelector: "#projectChatSendBtn"
          });
        } catch (err) {
          logger.error('[safeInit]', err, { context: 'app:safeInit:ChatExtensions' });
          throw err;
        }
      }
    }, 'projectSelected/init chat'),
    { description: 'Initialize ChatManager on projectSelected', context: 'app' }
  );
}

function registerAppListeners() {
  domReadinessService.dependenciesAndElements({
    deps: ['auth', 'chatManager', 'projectManager', 'eventHandlers'],
    context: 'app.js:registerAppListeners'
  })
    .then(() => {
      setupChatInitializationTrigger();
    })
    .catch(() => {
      // Error handled silently
    });
}

function handleInitError(err) {
  const modalManager = DependencySystem.modules.get?.('modalManager');
  const shownViaModal = modalManager?.show?.('error', {
    title: 'Application initialization failed',
    message: err?.message || 'Unknown initialization error',
    showDuringInitialization: true
  });

  // Emitir evento centralizado para otros módulos
  domAPI.dispatchEvent(
    domAPI.getDocument(),
    new CustomEvent('app:initError', { detail: { error: err } })
  );

  // Fallback visible sólo si no existe el modal
  if (!shownViaModal) {
    try {
      const errorContainer = domAPI.getElementById('appInitError');
      if (errorContainer) {
        domAPI.setTextContent(
          errorContainer,
          `Application initialization failed: ${err?.message || 'Unknown error'}`
        );
        domAPI.removeClass(errorContainer, 'hidden');
      }
    } catch (displayErr) {
      logger.error('[handleInitError]', displayErr, { context: 'app:handleInitError' });
      // Error handled silently
    }
  }
}

// ---------------------------------------------------------------------------
// 14) Main initialization function
// ---------------------------------------------------------------------------
export async function init() {
  logger.log('[App.init] Called', { context: 'app:init', ts: Date.now() });

  // Ensure the DOM is fully loaded before initialization
  await domReadinessService.documentReady();

  // ────────── timing helpers ──────────
  const phaseTimings = Object.create(null);     // { [phase]: { start, end } }
  const SLOW_PHASE = 4_000;                     // ms – warn if phase ≥ 4 s
  function _now() {
    const w = browserAPI.getWindow();
    return (w?.performance?.now?.()) ?? Date.now();
  }

  // Global emergency fail-safe: if this init hasn't completed in the configured time, forcibly log & dispatch 'app:ready' with error
  let globalInitTimeoutFired = false;
  const GLOBAL_INIT_TIMEOUT_MS = (
    (APP_CONFIG && APP_CONFIG.TIMEOUTS && typeof APP_CONFIG.TIMEOUTS.GLOBAL_INIT === 'number')
      ? APP_CONFIG.TIMEOUTS.GLOBAL_INIT
      : 90000 // Default: 90 seconds
  );
  const globalInitTimeoutId = browserAPI.getWindow().setTimeout(() => {
    globalInitTimeoutFired = true;
    const err = new Error(
      `[App.init] Global initialization timeout after ${GLOBAL_INIT_TIMEOUT_MS}ms.`
    );
    logger.error('[App.init] Emergency global timeout', err, { context: 'app:init:globalTimeout', ts: Date.now() });
    handleInitError(err);
    fireAppReady(false, err);
  }, GLOBAL_INIT_TIMEOUT_MS);

  if (_globalInitCompleted || _globalInitInProgress) {
    browserAPI.getWindow().clearTimeout(globalInitTimeoutId);
    return _globalInitCompleted;
  }
  if (appModule.state.initialized || appModule.state.initializing) {
    browserAPI.getWindow().clearTimeout(globalInitTimeoutId);
    return appModule.state.initialized;
  }

  _globalInitInProgress = true;
  appModule.setAppLifecycleState({ initializing: true, currentPhase: 'starting_init_process' });

  toggleLoadingSpinner(true);

  // Per-phase timeout in ms for each awaited step
  const PHASE_TIMEOUT = 12000; // 12s per step to catch long hangs

  // Diagnostic step marker
  function logStep(phase, stage, extra = {}) {
    const t = _now();
    if (stage === 'pre') {
      phaseTimings[phase] = { start: t };             // mark start
    } else if (stage === 'post') {
      const rec = phaseTimings[phase] || (phaseTimings[phase] = {});
      rec.end = t;
      const dur = rec.end - (rec.start ?? rec.end);
      logger.log('[App.init][TIMING]', { phase, duration: Math.round(dur), context: 'app:init:timing' });
      if (dur >= SLOW_PHASE) {
        logger.warn(`[App.init] Phase "${phase}" took ${Math.round(dur)} ms`, { phase, duration: dur, context: 'app:init:timing' });
      }
    }
    logger.log('[App.init]', { phase, stage, ts: t, ...extra });
  }

  try {
    // 1) Initialize core systems in order
    logStep('initializeCoreSystems', 'pre');
    await Promise.race([
      initializeCoreSystems(),
      new Promise((_, reject) =>
        browserAPI.getWindow().setTimeout(
          () => reject(new Error('Timeout in initializeCoreSystems')),
          PHASE_TIMEOUT
        )
      )
    ]);
    logStep('initializeCoreSystems', 'post');

    /* ── Wait for critical DI modules via domReadinessService ─────────── */
    logStep('depsReady', 'pre');
    await domReadinessService.dependenciesAndElements({
      deps: ['auth', 'eventHandlers', 'modalManager'],
      timeout: APP_CONFIG.TIMEOUTS?.DEPENDENCY_WAIT ?? PHASE_TIMEOUT,
      context: 'app.init:depsReady'
    });
    logStep('depsReady', 'post');

    // 3) Initialize auth system
    logStep('initializeAuthSystem', 'pre');
    await Promise.race([
      authInit.initializeAuthSystem(),
      new Promise((_, reject) =>
        browserAPI.getWindow().setTimeout(
          () => reject(new Error('Timeout in initializeAuthSystem')),
          PHASE_TIMEOUT
        )
      )
    ]);
    logStep('initializeAuthSystem', 'post');
    // Early app:ready dispatch: emits right after auth is ready (guaranteed single-fire)
    if (!_appReadyDispatched) fireAppReady(true);

    // 4) If authenticated, fetch current user
    logStep('fetchCurrentUser', 'pre', { authed: !!appModule.state.isAuthenticated });
    if (appModule.state.isAuthenticated) {
      const user = await Promise.race([
        fetchCurrentUser(),
        new Promise((_, reject) =>
          browserAPI.getWindow().setTimeout(
            () => reject(new Error('Timeout in fetchCurrentUser')),
            PHASE_TIMEOUT
          )
        )
      ]);
      if (user) {
        app.setCurrentUser(user);
        browserAPI.setCurrentUser(user);
      }
    }
    logStep('fetchCurrentUser', 'post');

    // 5) Initialize UI components
    logStep('initializeUIComponents', 'pre');
    await Promise.race([
      initializeUIComponents(),
      new Promise((_, reject) =>
        browserAPI.getWindow().setTimeout(
          () => reject(new Error('Timeout in initializeUIComponents')),
          PHASE_TIMEOUT
        )
      )
    ]);
    logStep('initializeUIComponents', 'post');

    // 6) (Optional) initialize leftover model config UI
    logStep('modelConfig.initializeUI', 'pre');
    const mc = DependencySystem.modules.get('modelConfig');
    if (mc?.initializeUI) {
      mc.initializeUI();
    }
    logStep('modelConfig.initializeUI', 'post');

    // 7) Register app-level listeners
    logStep('registerAppListeners', 'pre');
    registerAppListeners();
    logStep('registerAppListeners', 'post');

    // 8) Initialize navigation service
    logStep('navigationService', 'pre');
    const navService = DependencySystem.modules.get('navigationService');
    if (!navService) {
      throw new Error('[App] NavigationService missing from DI. Aborting initialization.');
    }
    navigationService = navService;

    if (navigationService?.init) {
      await Promise.race([
        navigationService.init(),
        new Promise((_, reject) =>
          browserAPI.getWindow().setTimeout(
            () => reject(new Error('Timeout in navigationService.init')),
            PHASE_TIMEOUT
          )
        )
      ]);

      // Register default views
      const projectDashboard = DependencySystem.modules.get('projectDashboard');
      if (projectDashboard?.components) {

        // Enhanced projectList view registration with dependency waiting
        if (!navigationService.hasView('projectList')) {
          navigationService.registerView('projectList', {
            show: async () => {
              try {
                await domReadinessService.dependenciesAndElements({
                  deps: ['projectDashboard', 'projectListComponent'],
                  timeout: 10000,
                  context: 'app.js:nav:projectList'
                });

                const dashboard = DependencySystem.modules.get('projectDashboard');
                if (dashboard?.showProjectList) {
                  await dashboard.showProjectList();
                  return true;
                } else {
                  const plc = DependencySystem.modules.get('projectListComponent');
                  if (plc?.show) {
                    await plc.show();
                    return true;
                  }
                }
                return false;
              } catch (err) {
                logger.error('[initializeUIComponents]', err, { context: 'app:initializeUIComponents:projectList:show' });
              }
            },
            hide: async () => {
              try {
                const dashboard = DependencySystem.modules.get('projectDashboard');
                if (dashboard?.components?.projectList?.hide) {
                  await dashboard.components.projectList.hide();
                  return true;
                }
                const plc = DependencySystem.modules.get('projectListComponent');
                if (plc?.hide) {
                  await plc.hide();
                  return true;
                }
                return false;
              } catch (err) {
                logger.error('[initializeUIComponents]', err, { context: 'app:initializeUIComponents:projectList:hide' });
              }
            }
          });
        }

        // Enhanced projectDetails view registration with dependency waiting
        if (!navigationService.hasView('projectDetails')) {
          navigationService.registerView('projectDetails', {
            show: async (params) => {
              try {
                await domReadinessService.dependenciesAndElements({
                  deps: ['projectDashboard', 'projectDetailsComponent'],
                  timeout: 10000,
                  context: 'app.js:nav:projectDetails'
                });

                const dashboard = DependencySystem.modules.get('projectDashboard');
                if (dashboard?.showProjectDetails) {
                  await dashboard.showProjectDetails(params.projectId);
                  return true;
                }
                const pdc = DependencySystem.modules.get('projectDetailsComponent');
                if (pdc?.showProjectDetails) {
                  await pdc.showProjectDetails(params.projectId);
                  return true;
                }
                return false;
              } catch (err) {
                logger.error('[pm?.loadProjects]', err, { context: 'app:projectManager:loadProjects' });
              }
            },
            hide: async () => {
              try {
                const dashboard = DependencySystem.modules.get('projectDashboard');
                if (dashboard?.components?.projectDetails?.hideProjectDetails) {
                  await dashboard.components.projectDetails.hideProjectDetails();
                  return true;
                }
                const pdc = DependencySystem.modules.get('projectDetailsComponent');
                if (pdc?.hideProjectDetails) {
                  await pdc.hideProjectDetails();
                  return true;
                }
                return false;
              } catch (err) {
                logger.error('[initializeUIComponents]', err, { context: 'app:initializeUIComponents:projectList:hide' });
                throw err;
              }
            }
          });
        }
      }
    }
    logStep('navigationService', 'post');

    appModule.setAppLifecycleState({ initialized: true });
    _globalInitCompleted = true;

    // Log a compact summary of all timings
    Object.entries(phaseTimings).forEach(([p, { start, end }]) => {
      if (start && end) {
        const d = Math.round(end - start);
        logger.info(`[App.init] Phase "${p}" duration: ${d} ms`);
      }
    });

    // Log DOM selector wait stats
    const selStats = domReadinessService.getSelectorTimings?.() || {};
    Object.entries(selStats)
      .sort(([, a], [, b]) => b - a)
      .forEach(([sel, ms]) =>
        logger.info(`[Perf] DOM selector "${sel}" waited ${ms} ms total`));
    domAPI.getDocument()?.dispatchEvent(
      new CustomEvent('app:domSelectorTimings', { detail: selStats })
    );

    if (!globalInitTimeoutFired) {
      browserAPI.getWindow().clearTimeout(globalInitTimeoutId);
      fireAppReady(true);
    }
    return true;
  } catch (err) {
    logger.error('[init]', err, { context: 'app:init', ts: Date.now() });
    throw err;
  } finally {
    _globalInitInProgress = false;
    appModule.setAppLifecycleState({
      initializing: false,
      currentPhase: appModule.state.initialized ? 'initialized_idle' : 'failed_idle'
    });
    toggleLoadingSpinner(false);
  }
}

// ---------------------------------------------------------------------------
// 15) Core systems initialization
// ---------------------------------------------------------------------------
const {
  initializeCoreSystems
} = createCoreInitializer({
  DependencySystem,
  domAPI,
  browserService: browserServiceInstance,
  eventHandlers,
  sanitizer,
  logger,
  APP_CONFIG,
  domReadinessService
});

// ---------------------------------------------------------------------------
// 16) UI component initialization
// ---------------------------------------------------------------------------
let _uiInitialized = false;

async function initializeUIComponents() {
  if (_uiInitialized) {
    return;
  }

  let domAndModalsReady = false;
  try {
    // First, wait for critical DOM elements
    await domReadinessService.dependenciesAndElements({
      domSelectors: [
        '#projectListView',     // contenedor que ya existe en el HTML base
        '#projectDetailsView'   // idem
        // '#knowledgeTab' // REMOVED: This element is in project_details.html and loaded dynamically.
      ],
      timeout: 10000, // Adjusted timeout for clarity
      context: 'app.js:initializeUIComponents:domCheck'
    });

    /* ── Mobile sidebar open/close helpers ───────────────── */
    const navToggleBtn = domAPI.getElementById('navToggleBtn');
    const closeSidebarBtn = domAPI.getElementById('closeSidebarBtn');
    const doc = domAPI.getDocument();

    function setSidebarOpen(open) {
      const sidebar = domAPI.getElementById('mainSidebar');
      // freeze / release background scroll
      domAPI[open ? 'addClass' : 'removeClass'](doc.body, 'sidebar-open');
      domAPI[open ? 'addClass' : 'removeClass'](doc.documentElement, 'sidebar-open');

      // slide sidebar in/out
      if (sidebar) {
        domAPI[open ? 'addClass' : 'removeClass'](sidebar, 'translate-x-0');
        domAPI[open ? 'removeClass' : 'addClass'](sidebar, '-translate-x-full');
        sidebar.setAttribute('aria-hidden', String(!open));
      }
      // update toggle button ARIA
      if (navToggleBtn) navToggleBtn.setAttribute('aria-expanded', String(open));
    }

    if (navToggleBtn) {
      eventHandlers.trackListener(
        navToggleBtn, 'click',
        safeHandler(() => setSidebarOpen(navToggleBtn.getAttribute('aria-expanded') !== 'true'), 'navToggleBtn:toggleSidebar'),
        { context: 'app:sidebar', description: 'toggleSidebar' }
      );
    }
    if (closeSidebarBtn) {
      eventHandlers.trackListener(
        closeSidebarBtn, 'click',
        () => setSidebarOpen(false),
        { context: 'app:sidebar', description: 'closeSidebar' }
      );
    }

    domAndModalsReady = true;

    // Call template injection now that DOM selectors are available
    const htmlLoader = DependencySystem.modules.get('htmlTemplateLoader');
    logger.log('[App] About to load project templates', { context: 'app.js:templateLoading' });

    // project_list.html
    if (htmlLoader && typeof htmlLoader.loadTemplate === 'function') {
      await htmlLoader.loadTemplate({
        url: '/static/html/project_list.html',
        containerSelector: '#projectListView',
        eventName: 'projectListLoaded'
      });
    }

    // project_details.html
    if (htmlLoader && typeof htmlLoader.loadTemplate === 'function') {
      await htmlLoader.loadTemplate({
        url: '/static/html/project_details.html',
        containerSelector: '#projectDetailsView',
        eventName: 'projectDetailsLoaded'
      });
    }

    logger.log('[App] Templates loaded, proceeding with component registration', { context: 'app.js:templateLoading' });

    // Register navigation views with the navigation service
    const navigationService = DependencySystem.modules.get('navigationService');
    if (navigationService && typeof navigationService.registerView === 'function') {
      // Wait for project list elements to be ready
      await domReadinessService.dependenciesAndElements({
        domSelectors: ['#projectListContainer'],
        timeout: APP_CONFIG.TIMEOUTS?.PROJECT_LIST_ELEMENTS ?? 5000,
        context: 'app.js:initializeUIComponents:projectListElements'
      });

      navigationService.registerView('projectList', {
        selector: '#projectListView',
        onActivate: async () => {
          logger.log('[App] Activating project list view', { context: 'app.js:navigation:projectList' });
          // Additional activation logic can go here
        }
      });

      // Wait for project details elements to be ready
      await domReadinessService.dependenciesAndElements({
        domSelectors: ['#projectDetailsContainer'],
        timeout: APP_CONFIG.TIMEOUTS?.PROJECT_DETAILS_ELEMENTS ?? 5000,
        context: 'app.js:initializeUIComponents:projectDetailsElements'
      });

      navigationService.registerView('projectDetails', {
        selector: '#projectDetailsView',
        onActivate: async () => {
          logger.log('[App] Activating project details view', { context: 'app.js:navigation:projectDetails' });
          // Additional activation logic can go here
        }
      });

      logger.log('[App] Navigation views registered', { context: 'app.js:navigation' });
    }

    // Wait for additional components to be loaded and then create them
    await createAndRegisterUIComponents();

  } catch (err) {
    logger.error('[App] Error during UI initialization', err, { context: 'app.js:initializeUIComponents' });
    throw err;
  }

  _uiInitialized = true;
}

async function createAndRegisterUIComponents() {
  // Project Details Enhancements - Create and register visual improvements
  const projectDetailsEnhancementsInstance = createProjectDetailsEnhancements({
    domAPI,
    browserService: browserServiceInstance,
    eventHandlers,
    domReadinessService,
    logger,
    sanitizer
  });
  DependencySystem.register('projectDetailsEnhancements', projectDetailsEnhancementsInstance);

  // Token Stats Manager - Create and register token stats functionality
  const tokenStatsManagerInstance = createTokenStatsManager({
    apiClient: apiRequest,
    domAPI,
    eventHandlers,
    browserService: browserServiceInstance,
    modalManager: DependencySystem.modules.get('modalManager'),
    sanitizer,
    logger,
    projectManager: DependencySystem.modules.get('projectManager'),
    app,
    chatManager: DependencySystem.modules.get('chatManager'),
    domReadinessService
  });
  DependencySystem.register('tokenStatsManager', tokenStatsManagerInstance);

  safeInit(projectDetailsEnhancementsInstance, 'ProjectDetailsEnhancements', 'initialize')
    .catch(err => logger.error('[createAndRegisterUIComponents]', err, { context: 'app:createAndRegisterUIComponents:projectDetailsEnhancements' }));

  // Knowledge Base Component - Create and register if not already present.
  let knowledgeBaseComponentInstance = DependencySystem.modules.get('knowledgeBaseComponent');
  if (!knowledgeBaseComponentInstance) {
    try {
      knowledgeBaseComponentInstance = createKnowledgeBaseComponent({
        DependencySystem,
        apiRequest, // KBC factory needs this
        projectManager: DependencySystem.modules.get('projectManager'), // KBC factory needs this
        uiUtils, // KBC factory needs this
        sanitizer: DependencySystem.modules.get('sanitizer') // KBC factory needs this
        // elRefs can be omitted; component should query when container exists
      });
    } catch (err) {
      logger.warn('[createAndRegisterUIComponents] KnowledgeBaseComponent creation failed; falling back to placeholder.', { context: 'app:createAndRegisterUIComponents', error: err?.message });
      logger.error('[createAndRegisterUIComponents] KnowledgeBaseComponent creation failed', err, { context: 'app:createAndRegisterUIComponents:KnowledgeBaseComponent' });
      logger.error('[createAndRegisterUIComponents] Error in createKnowledgeBaseComponent', err, { context: 'app:createAndRegisterUIComponents:createKnowledgeBaseComponent' });
      throw err;
    }
    DependencySystem.register('knowledgeBaseComponent', knowledgeBaseComponentInstance);
  }

  // Project Details Component - Assumed to be created in initializeCoreSystems.
  // Inject KnowledgeBaseComponent into it.
  const projectDetailsComponent = DependencySystem.modules.get('projectDetailsComponent');
  if (projectDetailsComponent) {
    if (typeof projectDetailsComponent.setKnowledgeBaseComponent === 'function') {
      projectDetailsComponent.setKnowledgeBaseComponent(knowledgeBaseComponentInstance);
    } else {
      logger.warn('[createAndRegisterUIComponents] projectDetailsComponent is missing setKnowledgeBaseComponent method.', { context: 'app:createAndRegisterUIComponents' });
    }
  } else {
    // This case should ideally not happen if initializeCoreSystems always registers it.
    logger.warn('[createAndRegisterUIComponents] projectDetailsComponent not found in DI. Cannot inject KBC.', { context: 'app:createAndRegisterUIComponents' });
  }

  // Project List Component - Assumed to be created in initializeCoreSystems.
  // No re-creation or re-registration needed here.
  const projectListComponent = DependencySystem.modules.get('projectListComponent');
  if (!projectListComponent) {
    logger.warn('[createAndRegisterUIComponents] projectListComponent not found in DI.', { context: 'app:createAndRegisterUIComponents' });
  }

  // Update ProjectDashboard references using the new setter methods
  const projectDashboardInstance = DependencySystem.modules.get('projectDashboard');
  if (projectDashboardInstance) {
    const pdcForDashboard = DependencySystem.modules.get('projectDetailsComponent');
    const plcForDashboard = DependencySystem.modules.get('projectListComponent');

    if (pdcForDashboard && typeof projectDashboardInstance.setProjectDetailsComponent === 'function') {
      projectDashboardInstance.setProjectDetailsComponent(pdcForDashboard);
    } else if (pdcForDashboard) {
      logger.warn('[createAndRegisterUIComponents] projectDashboardInstance missing setProjectDetailsComponent method.', { context: 'app:createAndRegisterUIComponents' });
      // Fallback to direct assignment if setter is missing but component exists (less ideal)
      if (projectDashboardInstance.components) projectDashboardInstance.components.projectDetails = pdcForDashboard;
    }

    if (plcForDashboard && typeof projectDashboardInstance.setProjectListComponent === 'function') {
      projectDashboardInstance.setProjectListComponent(plcForDashboard);
    } else if (plcForDashboard) {
      logger.warn('[createAndRegisterUIComponents] projectDashboardInstance missing setProjectListComponent method.', { context: 'app:createAndRegisterUIComponents' });
      // Fallback
      if (projectDashboardInstance.components) projectDashboardInstance.components.projectList = plcForDashboard;
    }
  } else {
    logger.warn('[createAndRegisterUIComponents] projectDashboardInstance not found. Cannot set sub-components.', { context: 'app:createAndRegisterUIComponents' });
  }
}


if (typeof window !== 'undefined') {
  // Setup global error handling using errorInit module
  errorInit.initializeErrorHandling();

  const doc = browserAPI.getDocument();
  // Use forceShowLoginModal from authInit module
  const forceShowLoginModal = authInit.forceShowLoginModal;

  // ---------------------------------------------------------------------
  // 🚀 Auto-bootstrap the application
  // ---------------------------------------------------------------------
  // app.js is the only file in the codebase allowed to run side-effects at
  // import time.  Previous refactors accidentally removed the automatic
  // invocation of `init()`, leaving the loading spinner visible forever
  // because initialization never started.  We restore the behaviour by
  // kicking off the async init sequence once the module is evaluated in the
  // browser environment.  Any error is surfaced through the DI-provided
  // logger so that it reaches the unified logging pipeline.

  (async () => {
    try {
      await init();
    } catch (err) {
      const log = DependencySystem?.modules?.get?.('logger');
      if (log?.error) {
        log.error('[app.js][bootstrap] init() failed', err, { context: 'app:bootstrap' });
      }
      // Fire app:ready with failure so external listeners are unblocked
      try {
        fireAppReady(false, err);
    } catch (e) {
      logger.error('[App] Failed to display sidebar error in banner', e && e.stack ? e.stack : e, { context: 'app:sidebar:errorBanner' });
      logger.error('[app.js][bootstrap] Error in fireAppReady', e, { context: 'app:bootstrap:fireAppReady' });
      throw e;
    }
  }
  })();
}
