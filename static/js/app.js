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

import MODAL_MAPPINGS from './modalConstants.js';
import { FileUploadComponent } from './FileUploadComponent.js';

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

const logger = createLogger({
  context: 'App',
  debug: APP_CONFIG && APP_CONFIG.DEBUG === true
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
  const detail = success ? { success } : { success, error };
  AppBus.dispatchEvent(new CustomEvent('app:ready', { detail }));
  domAPI.getDocument()?.dispatchEvent(new CustomEvent('app:ready', { detail }));
  DependencySystem.modules.get('logger')?.log('[fireAppReady] dispatched', { success, error, context: 'app' });
}

const domAPI = createDomAPI({
  documentObject: browserAPI.getDocument(),
  windowObject: browserAPI.getWindow(),
  debug: APP_CONFIG.DEBUG === true,
  logger
});

// ---------------------------------------------------------------------------
// 3) Register base services
// ---------------------------------------------------------------------------
DependencySystem.register('domAPI', domAPI);

// Wait until sanitizer is initialized before constructing eventHandlers
let sanitizer = browserAPI.getWindow()?.DOMPurify;
if (!sanitizer) {
  throw new Error(
    '[App] DOMPurify not found - aborting bootstrap for security reasons. ' +
    'Load it with SRI before app.js'
  );
}
DependencySystem.register('sanitizer', sanitizer);
DependencySystem.register('domPurify', sanitizer); // legacy alias

const errorReporter =
  { report: (...args) => logger.error('[ErrorReporterStub]', ...args) };
DependencySystem.register('errorReporter', errorReporter);

const eventHandlers = createEventHandlers({
  DependencySystem,
  domAPI,
  browserService: browserServiceInstance,
  APP_CONFIG,
  sanitizer,
  logger,
  errorReporter
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
DependencySystem.register('FileUploadComponent', FileUploadComponent);

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
// 4) Early app module
// ---------------------------------------------------------------------------
const appModule = {
  state: {
    isAuthenticated: false,
    currentUser: null,
    isReady: false, // True when app is fully initialized and safe for interaction
    disableErrorTracking: false,
    initialized: false, // True when the main init() sequence has completed (success or fail)
    initializing: false, // True if init() is currently executing
    currentPhase: 'idle' // e.g., 'idle', 'starting_init_process', 'initialized_idle', 'failed_idle'
  },
  // Method to update authentication-related state
  setAuthState(newAuthState) {
    DependencySystem.modules.get('logger').log('[DIAGNOSTIC][appModule.setAuthState]', JSON.stringify(newAuthState));
    Object.assign(this.state, newAuthState);
  },
  // Method to update general app lifecycle state
  setAppLifecycleState(newLifecycleState) {
    Object.assign(this.state, newLifecycleState);
    // If 'initialized' becomes true, set 'isReady' based on success/failure
    if (newLifecycleState.initialized === true) {
        if (this.state.currentPhase === 'initialized_idle') {
            this.state.isReady = true;
        } else if (this.state.currentPhase === 'failed_idle') {
            this.state.isReady = false; // Explicitly false if init failed
        }
    } else if (Object.prototype.hasOwnProperty.call(newLifecycleState, 'isReady')) { // Allow direct setting of isReady if needed
        this.state.isReady = newLifecycleState.isReady;
    }
  }
};
DependencySystem.register('appModule', appModule);

// ---------------------------------------------------------------------------
// Temporary stub: register an empty "app" early so any
// DependencySystem.waitFor('app') calls in factories executed below
// succeed immediately. The full App API is assigned later.
const app = {};
DependencySystem.register('app', app);

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
    setTimeout : (...args) => browserAPI.getWindow().setTimeout(...args),
    clearTimeout: (...args) => browserAPI.getWindow().clearTimeout(...args)
  }
});
DependencySystem.register('htmlTemplateLoader', htmlTemplateLoader);

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
    apiEndpoints
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
// 14) Main initialization function
// ---------------------------------------------------------------------------
export async function init() {
  logger.log('[App.init] Called', { context: 'app:init', ts: Date.now() });

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
      logger.log('[App.init][TIMING]', { phase, duration: Math.round(dur) });
      if (dur >= SLOW_PHASE) {
        logger.warn(`[App.init] Phase "${phase}" took ${Math.round(dur)} ms`, { phase, duration: dur });
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

    // 2) Wait for critical dependencies
    logStep('DependencySystem.waitFor', 'pre');
    await Promise.race([
      DependencySystem.waitFor(
        ['auth', 'eventHandlers', 'modalManager'],
        null,
        APP_CONFIG.TIMEOUTS?.DEPENDENCY_WAIT
      ),
      new Promise((_, reject) =>
        browserAPI.getWindow().setTimeout(
          () => reject(new Error('Timeout in DependencySystem.waitFor')),
          PHASE_TIMEOUT
        )
      )
    ]);
    logStep('DependencySystem.waitFor', 'post');

    // 3) Initialize auth system
    logStep('initializeAuthSystem', 'pre');
    await Promise.race([
      initializeAuthSystem(),
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
                return false;
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
      .sort(([,a],[,b]) => b - a)
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
    if (!globalInitTimeoutFired) {
      browserAPI.getWindow().clearTimeout(globalInitTimeoutId);
      logger.error('[init]', err, { context: 'app:init', ts: Date.now() });
      handleInitError(err);
      fireAppReady(false, err);
    }
    return false;
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
async function initializeCoreSystems() {
  logger.log('[initializeCoreSystems] Entering function', { context: 'app.initializeCoreSystems' });
  // Wait for minimal DOM readiness
  await domReadinessService.dependenciesAndElements({
    deps: ['domAPI'],
    domSelectors: ['body'],
    timeout: 10000,
    context: 'app.js:initializeCoreSystems'
  });

  // Create & init modal manager
  const modalManager = createModalManager({
    domAPI,
    browserService: browserServiceInstance,
    eventHandlers,
    DependencySystem,
    modalMapping: MODAL_MAPPINGS,
    domPurify: sanitizer
  });
  DependencySystem.register('modalManager', modalManager);

  // Create auth module
  const authModule = createAuthModule({
    DependencySystem,
    apiClient: apiRequest,
    eventHandlers,
    domAPI,
    sanitizer,
    APP_CONFIG,           // pass full app configuration
    modalManager,
    apiEndpoints,
    logger, // Pass the DI logger (registered above)
    domReadinessService
  });
  DependencySystem.register('auth', authModule);
logger.log('[initializeCoreSystems] auth module registered', { context: 'app.initializeCoreSystems' });
// Initialize auth module to set up event listeners
await authModule.init().catch(err => {
    const logMsg = (err && (err.message || err.stack)) ? `Auth module initialization error: ${err.message}\n${err.stack}` : `[App] Auth module initialization error: ${JSON.stringify(err)}`;
    DependencySystem.modules.get('logger').error('[App] ' + logMsg, err);
  });

  // Create model config
  const modelConfigInstance = createModelConfig({
    dependencySystem: DependencySystem,          // mandatory (note lower-camel case)
    domReadinessService: DependencySystem.modules.get('domReadinessService'),
    eventHandler: eventHandlers,                 // centralised listener tracker
    storageHandler: DependencySystem.modules.get('storage'),
    sanitizer: DependencySystem.modules.get('sanitizer')
  });
  DependencySystem.register('modelConfig', modelConfigInstance);

  // Create or retrieve chatManager
  const chatManager = createOrGetChatManager();

    // Create projectManager
  const pmFactory = await createProjectManager({
    DependencySystem,
    chatManager,
    app,
    modelConfig: modelConfigInstance,
    apiRequest,
    apiEndpoints,
    storage: DependencySystem.modules.get('storage'),
    listenerTracker: {
      add: (el, type, handler, description) =>
        eventHandlers.trackListener(el, type, handler, {
          description,
          context: 'projectManager'
        }),
      remove: () => eventHandlers.cleanupListeners({ context: 'projectManager' })
    },
    domAPI,
    domReadinessService,
    logger // Ensures strict DI per guardrails/compliance for projectManager
  });
  const projectManager = pmFactory.instance;
  eventHandlers.setProjectManager?.(projectManager);

  // Initialize eventHandlers now that its downstream deps exist
  if (eventHandlers?.init) {
    await eventHandlers.init();
    logger.log('[initializeCoreSystems] eventHandlers initialization complete', { context: 'app.initializeCoreSystems' });
  }

  // ------------------------------------------------------------------------
  // Early stub/component registration for projectListComponent and projectDetailsComponent
  // To avoid "Optional module ... not found" warnings in ProjectDashboard constructor,
  // instantiate and register placeholder or real component objects before dashboard creation
  // ------------------------------------------------------------------------
  function createPlaceholder(name) {
    return {
      state: { initialized: false },
      initialize: async () => {},
      show: () => {},
      hide: () => {},
      cleanup: () => {},
      __placeholder: true,
      toString() { return `[Placeholder ${name}]`; }
    };
  }

  if (!DependencySystem.modules.has('projectListComponent')) {
    // Safe to construct the real instance early as its constructor does not touch the DOM yet,
    // but you may also opt to use createPlaceholder('projectListComponent') if real dependencies might be incomplete here.
    const earlyPLC = createProjectListComponent({
      projectManager,
      eventHandlers,
      modalManager: DependencySystem.modules.get('modalManager'),
      app,
      router: DependencySystem.modules.get('navigationService'),
      storage: DependencySystem.modules.get('storage'),
      sanitizer: DependencySystem.modules.get('sanitizer'),
      htmlSanitizer: DependencySystem.modules.get('sanitizer'),
      apiClient: DependencySystem.modules.get('apiRequest'),
      domAPI,
      domReadinessService,
      browserService: browserServiceInstance,
      globalUtils: DependencySystem.modules.get('globalUtils'),
      APP_CONFIG,
      logger
    });
    DependencySystem.register('projectListComponent', earlyPLC);
  }

  if (!DependencySystem.modules.has('projectDetailsComponent')) {
    const earlyPDC = createProjectDetailsComponent({
      projectManager,
      eventHandlers,
      modalManager: DependencySystem.modules.get('modalManager'),
      FileUploadComponentClass: DependencySystem.modules.get('FileUploadComponent'),
      domAPI,
      sanitizer: DependencySystem.modules.get('sanitizer'),
      app,
      navigationService: DependencySystem.modules.get('navigationService'),
      htmlTemplateLoader,               // ensures template loading available
      logger,                           // DI-provided logger
      APP_CONFIG,                       // optional but useful for PDC
      chatManager: DependencySystem.modules.get('chatManager'),
      modelConfig: DependencySystem.modules.get('modelConfig'),
      knowledgeBaseComponent: null,     // injected later in UI phase
      apiClient: apiRequest,            // optional helper for sub-components
      domReadinessService
    });
    DependencySystem.register('projectDetailsComponent', earlyPDC);
  }
  // ------------------------------------------------------------------------

  // Create project dashboard with strict dependency injection
  const projectDashboard = createProjectDashboard({
    dependencySystem: DependencySystem,
    domAPI,
    browserService: browserServiceInstance,
    eventHandlers,
    logger, // Inject logger DI as required by dashboard
    sanitizer,
    APP_CONFIG,           // pass full app configuration
    domReadinessService
  });
  DependencySystem.register('projectDashboard', projectDashboard);

  // Create project modal
  const projectModal = createProjectModal({
    DependencySystem,
    eventHandlers,
    domAPI,
    browserService: browserServiceInstance,
    domPurify: sanitizer
  });
  DependencySystem.register('projectModal', projectModal);

  // Wait for modals to load
  let modalsLoadedSuccess = false;

  // If the HTML was injected before this code ran, skip the event wait
  const injected = domAPI.getElementById('modalsContainer')?.childElementCount > 0;
  if (injected) {
    modalsLoadedSuccess = true;
  } else {
    await new Promise((res) => {
      eventHandlers.trackListener(
        domAPI.getDocument(),
        'modalsLoaded',
        (e) => {
          modalsLoadedSuccess = !!(e?.detail?.success);
          res(true);
        },
        { once: true, description: 'modalsLoaded for app init', context: 'app' }
      );
    });
  }

  // modalManager.init
  if (modalManager.init) {
    try {
      await modalManager.init();
              } catch (err) {
                logger.error('[projectList:show]', err, { context: 'app:nav:projectList:show' });
                return false;
              }
  }

  return true;
}

// ---------------------------------------------------------------------------
// 16) Moved UI creation to the UI init phase
// ---------------------------------------------------------------------------
let _uiInitialized = false;
if (import.meta?.hot) {
  import.meta.hot.dispose(() => {
    _uiInitialized = false;
  });
}

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

    // Load project list template into #projectListView
    const htmlLoader = DependencySystem.modules.get('htmlTemplateLoader');
    const loggerInstance = DependencySystem.modules.get('logger'); // Get logger for this operation

    if (htmlLoader && typeof htmlLoader.loadTemplate === 'function') {
      try {
        loggerInstance.log(
          '[App][initializeUIComponents] Loading project_list.html template into #projectListView',
          { context: 'app:loadTemplates' }
        );
        await htmlLoader.loadTemplate({
          url: '/static/html/project_list.html',
          containerSelector: '#projectListView', // This element is confirmed to exist by the domReadinessService call above
          eventName: 'projectListHtmlLoaded'     // Event ProjectDashboard waits for
        });
        loggerInstance.log(
          '[App][initializeUIComponents] project_list.html template loaded and event projectListHtmlLoaded dispatched.',
          { context: 'app:loadTemplates' }
        );

        const projectListContainer = domAPI.getElementById('projectListView');
        if (projectListContainer) {
          loggerInstance.log(
            '[App][initializeUIComponents] #projectListView childElementCount=' +
              projectListContainer.childElementCount,
            { context: 'app:loadTemplates' }
          );
        } else {
          loggerInstance.warn(
            '[App][initializeUIComponents] #projectListView not found after injection',
            { context: 'app:loadTemplates' }
          );
        }
      } catch (err) {
        loggerInstance.error(
          '[App][initializeUIComponents] Failed to load project_list.html template',
          err,
          { context: 'app:loadTemplates' }
        );
        // Potentially re-throw or handle critical failure if this template is essential for app operation
      }
    } else {
      loggerInstance.error(
        '[App][initializeUIComponents] htmlTemplateLoader.loadTemplate is not available. Cannot load project_list.html.',
        { context: 'app:loadTemplates' }
      );
    }

    /*  Esperamos, como máximo 8 s, al evento disparado por ModalManager
        (“modalmanager:initialized”).  Si no llega NO abortamos la
        inicialización de la UI: simplemente continuamos con una
        advertencia. */
    await Promise.race([
      domReadinessService.waitForEvent('modalmanager:initialized', {
        timeout: 8000,
        context: 'app:initializeUIComponents:modalmanagerReady'
      }).catch(() => {
        logger.warn('[initializeUIComponents] ModalManager not ready after 8 s – continuing without blocking.', {
          context: 'app:initializeUIComponents'
        });
      }),
      // Fallback de tiempo (misma duración) para no colgar el await
      new Promise(resolve => browserAPI.getWindow().setTimeout(resolve, 8000))
    ]);

    domAndModalsReady = true;   //  siempre continuamos; los modales pueden cargarse después
  } catch (err) {
    logger.error(
      '[initializeUIComponents] Error during DOM/modal readiness check',
      err,
      { context: 'app:initializeUIComponents:readinessError' }
    );
    // domAndModalsReady remains false
  }

  // Ya no abortamos si los modales aún no están listos

  createAndRegisterUIComponents();

  // ── Asegurar que ProjectDashboard registra las vistas reales ──────────
  const projectDashboardInstance = DependencySystem.modules.get('projectDashboard');
  if (projectDashboardInstance) {
    // no esperamos (fire-and-forget) para evitar dead-lock con ‘app:ready’
    safeInit(projectDashboardInstance, 'ProjectDashboard', 'initialize');
  }

  // Initialize accessibility
  await safeInit(accessibilityUtils, 'AccessibilityUtils', 'init');

  // Create chat extensions
  const chatExtensionsInstance = createChatExtensions({
    DependencySystem,
    eventHandlers,
    chatManager: DependencySystem.modules.get('chatManager'),
    auth: DependencySystem.modules.get('auth'),
    app: DependencySystem.modules.get('app'),
    domAPI,
    domReadinessService,   // NEW
    logger                 // NEW
  });
  DependencySystem.register('chatExtensions', chatExtensionsInstance);

  const chatMgr = DependencySystem.modules.get('chatManager');
  const authMod = DependencySystem.modules.get('auth');

  // Inicia de inmediato si ya está todo listo
  if (chatMgr?.isInitialized && authMod?.isAuthenticated?.()) {
    safeInit(chatExtensionsInstance, 'ChatExtensions', 'init');
  } else if (chatMgr?.chatBus) {
    eventHandlers.trackListener(
      chatMgr.chatBus,
      'chatManagerReady',
      () => {
        if (authMod?.isAuthenticated?.()) {
          safeInit(chatExtensionsInstance, 'ChatExtensions', 'init');
        }
      },
      {
        once: true,
        context: 'app.initializeUIComponents',
        description: 'deferred ChatExtensions.init'
      }
    );
  }

  // Create project dashboard utils
  const projectDashboardUtilsInstance = createProjectDashboardUtils({ DependencySystem });
  DependencySystem.register('projectDashboardUtils', projectDashboardUtilsInstance);

  // Create UI renderer
  const uiRendererInstance = createUiRenderer({
    domAPI,
    eventHandlers,
    apiRequest,
    apiEndpoints,
    onConversationSelect: async (conversationId) => {
      const chatManager = DependencySystem.modules.get('chatManager');
      if (chatManager?.loadConversation) {
        try {
          await chatManager.loadConversation(conversationId);
        } catch (err) {
          logger.error(
            '[onConversationSelect]',
            err,
            { context: 'app:uiRenderer:onConversationSelect' }
          );
          return false;
        }
      }
    },
    onProjectSelect: async (projectId) => {
      const projectDashboardDep = DependencySystem.modules.get('projectDashboard');
      if (projectDashboardDep?.showProjectDetails) {
        try {
          await projectDashboardDep.showProjectDetails(projectId);
        } catch (err) {
          logger.error(
            '[projectDetails:hide]',
            err,
            { context: 'app:nav:projectDetails:hide' }
          );
          return false;
        }
      }
    },
    domReadinessService, // Added missing dependency
    logger // Already present, but good to ensure all deps are listed together if reordering
  });
  DependencySystem.register('uiRenderer', uiRendererInstance);

  // Create sidebar
  let sidebarInstance = DependencySystem.modules.get('sidebar');
  if (!sidebarInstance) {
    sidebarInstance = createSidebar({
      DependencySystem,
      eventHandlers,
      app,
      projectDashboard: DependencySystem.modules.get('projectDashboard'),
      projectManager: DependencySystem.modules.get('projectManager'),
      uiRenderer: uiRendererInstance,
      storageAPI: DependencySystem.modules.get('storage'),
      domAPI,
      viewportAPI: { getInnerWidth: () => browserAPI.getInnerWidth() },
      accessibilityUtils: DependencySystem.modules.get('accessibilityUtils'),
      logger: DependencySystem.modules.get('logger'), // Pass the DI logger
      safeHandler: safeHandler, // Pass the safeHandler utility
      domReadinessService: DependencySystem.modules.get('domReadinessService'),
      APP_CONFIG // Pass config for sidebar debug logging
    });
    DependencySystem.register('sidebar', sidebarInstance);
  }

  // Instrumentation: explicitly log sidebar init result and report failure visibly.
  let sidebarInitSuccess = false;
  try {
    sidebarInitSuccess = await safeInit(sidebarInstance, 'Sidebar', 'init');
    if (!sidebarInitSuccess && logger && logger.error) {
      logger.error('[App] Sidebar init did not complete successfully.');
    }
  } catch (err) {
    if (logger && logger.error)
      logger.error('[App] Sidebar init failed', err && err.stack ? err.stack : err);
    // Visibly banner error in UI
    try {
      const errorBanner = domAPI.getElementById('appInitError');
      if (errorBanner) {
        const errorBannerText = domAPI.getElementById('appInitErrorText');
        if (errorBannerText) {
          domAPI.setTextContent(
            errorBannerText,
            `Sidebar initialization failed: ${err?.message || err}`
          );
        }
        domAPI.removeClass(errorBanner, 'hidden');
      }
    } catch (e) {
      // Last-resort: console
      if (logger && logger.error)
        logger.error('[App] Failed to display sidebar error in banner', e && e.stack ? e.stack : e);
    }
  }

  // If authenticated, load projects. Read from canonical state.
  if (appModule.state.isAuthenticated) {
    const pm = DependencySystem.modules.get('projectManager');
    pm?.loadProjects?.('all').catch(err => {
      // Error handled silently
    });
  }

  // External enhancements
  const w = browserAPI.getWindow();
  w?.initAccessibilityEnhancements?.({ domAPI });
  w?.initSidebarEnhancements?.({ domAPI, eventHandlers });

  // ── UI Diagnostics ─────────────────────────────────────────────
  if (APP_CONFIG.DEBUG_UI) {
    const unresolved = domReadinessService.getMissingSelectors?.() || [];
    if (unresolved.length) {
      logger.warn('[UI-Diagnostics] Unresolved selectors:', unresolved);
    } else {
      logger.info('[UI-Diagnostics] All selectors resolved.');
    }
  }
  _uiInitialized = true;
}

function createAndRegisterUIComponents() {
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

  // Initialize project details enhancements
  safeInit(projectDetailsEnhancementsInstance, 'ProjectDetailsEnhancements', 'initialize')
    .catch(err => logger.error('[createAndRegisterUIComponents]', err, { context: 'app:createAndRegisterUIComponents:projectDetailsEnhancements' }));

  // Knowledge Base Component - Create and register if not already present.
  let knowledgeBaseComponentInstance = DependencySystem.modules.get('knowledgeBaseComponent');
  if (!knowledgeBaseComponentInstance) {
    // Ensure all required elements for KBC are checked by domReadinessService in initializeUIComponents
    // or that KBC's constructor is robust enough for elRefs to be potentially null initially if lazy loaded.
    // Given the error, #knowledgeTab is critical.
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
      // Minimal placeholder to satisfy DI until real component can be instantiated by PDC later
      knowledgeBaseComponentInstance = {
        initialize: async () => {},
        renderKnowledgeBaseInfo: () => {}
      };
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

// ---------------------------------------------------------------------------
// 17) Auth system initialization
// ---------------------------------------------------------------------------
async function initializeAuthSystem() {
  const auth = DependencySystem.modules.get('auth');
  if (!auth?.init) {
    throw new Error('[App] Auth module is missing or invalid.');
  }

  // === DIAGNOSTIC: REGISTER AUTH EVENTS BEFORE INIT ===
  if (auth.AuthBus) {
    DependencySystem.modules.get('logger').log('[DIAGNOSTIC][initializeAuthSystem] Registering AuthBus listeners before auth.init');
    eventHandlers.trackListener(
      auth.AuthBus,
      'authStateChanged',
      (event) => {
        DependencySystem.modules.get('logger').log('[DIAGNOSTIC][AuthBus] Received authStateChanged', event?.detail);
        handleAuthStateChange(event);
      },
      { description: '[App] AuthBus authStateChanged', context: 'app' }
    );
    eventHandlers.trackListener(
      auth.AuthBus,
      'authReady',
      (event) => {
        DependencySystem.modules.get('logger').log('[DIAGNOSTIC][AuthBus] Received authReady', event?.detail);
        handleAuthStateChange(event);
      },
      { description: '[App] AuthBus authReady', context: 'app' }
    );
  } else {
    DependencySystem.modules.get('logger').warn('[DIAGNOSTIC][initializeAuthSystem] No AuthBus instance for auth event registration');
  }
  try {
    // auth.init() is responsible for verifying auth and calling broadcastAuth,
    // which in turn calls appModule.setAuthState().
    // So, appModule.state.isAuthenticated will be updated by auth.init() itself.
    DependencySystem.modules.get('logger').log('[DIAGNOSTIC][initializeAuthSystem] Calling auth.init()');
    await auth.init();

    renderAuthHeader(); // Ensure this renders based on the now canonical appModule.state (via local currentUser sync)
    return true;
  } catch (err) {
    // If auth.init() fails, ensure canonical state reflects non-authenticated.
    appModule.setAuthState({ isAuthenticated: false, currentUser: null });
    throw err;
  }
}

// ---------------------------------------------------------------------------
// 18) Additional helpers
// ---------------------------------------------------------------------------
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
    return false;
  }
}

function handleAuthStateChange(event) {
  // auth.js's broadcastAuth (via app.setAuthState) has already updated appModule.state
  // before this event listener is triggered.
  // This function now primarily reacts to that pre-established state.

  DependencySystem.modules.get('logger').log('[DIAGNOSTIC][handleAuthStateChange]', {
    eventDetail: event?.detail,
    appModuleState: JSON.stringify(appModule.state)
  });

  const isAuthenticated = appModule.state.isAuthenticated; // Read from canonical source
  const user = appModule.state.currentUser; // Read from canonical source

  // Update the local `currentUser` variable which might be used by renderAuthHeader or other legacy parts.
  currentUser = user;

  renderAuthHeader(); // Renders based on the local `currentUser`

  const chatManager = DependencySystem.modules.get('chatManager');
  if (chatManager?.setAuthState) {
    chatManager.setAuthState(isAuthenticated);
  }
  const projectManager = DependencySystem.modules.get('projectManager');
  if (projectManager?.setAuthState) {
    projectManager.setAuthState(isAuthenticated);
  }

  if (isAuthenticated) {
    const navService = DependencySystem.modules.get('navigationService');
    const drs = domReadinessService;
    const readyNow = _appReadyDispatched || appModule.state.isReady;
    const proceed = () => {
      if (navService?.navigateToProjectList) {
        navService.navigateToProjectList().catch(() => {
          // Error handled silently
        });
      } else if (projectManager?.loadProjects) {
        projectManager.loadProjects('all').catch(() => {
          // Error handled silently
        });
      }
    };
    if (readyNow) {
      proceed();
    } else {
      drs.waitForEvent('app:ready', {
        timeout: APP_CONFIG.TIMEOUTS?.APP_READY_WAIT ?? 30000,
        context: 'app:handleAuthStateChange'
      }).then(proceed).catch(() => {
        // Error handled silently
      });
    }
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

    if (isAuth) {
      if (authBtn) domAPI.addClass(authBtn, 'hidden');
      if (userMenu) domAPI.removeClass(userMenu, 'hidden');
    } else {
      if (authBtn) domAPI.removeClass(authBtn, 'hidden');
      if (userMenu) domAPI.addClass(userMenu, 'hidden');
      const orphan = domAPI.getElementById('headerLoginForm');
      if (orphan) orphan.remove();
    }

    if (isAuth && userMenu && userInitialsEl) {
      let initials = '?';
      if (user?.name) {
        initials = user.name.trim().split(/\s+/).map(p => p[0]).join('').toUpperCase();
      } else if (user?.username) {
        initials = user.username.trim().slice(0, 2).toUpperCase();
      }
      domAPI.setTextContent(userInitialsEl, initials);
    }

    if (authStatus) {
      domAPI.setTextContent(authStatus, isAuth
        ? (user?.username ? `Signed in as ${user.username}` : 'Authenticated')
        : 'Not Authenticated'
      );
    }

    if (userStatus) {
      domAPI.setTextContent(userStatus, isAuth && user?.username
        ? `Hello, ${user.name ?? user.username}`
        : 'Offline'
      );
    }

    if (logoutBtn) {
      eventHandlers.trackListener(
        logoutBtn,
        'click',
        safeHandler((e) => {
          domAPI.preventDefault(e);
          authMod?.logout?.();
        }, 'Auth logout button'),
        { description: 'Auth logout button', context: 'app' }
      );
    }
    } catch (err) {
      logger.error('[safeInit]', err, { context: 'app:safeInit:AccessibilityUtils' });
      // Error handled silently
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

// ---------------------------------------------------------------------------
// 21) App listeners and error handling
// ---------------------------------------------------------------------------
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
          await chatManager.initialize({ projectId, containerSelector: "#chatUIContainer" });
        } catch (err) {
          logger.error('[safeInit]', err, { context: 'app:safeInit:ChatExtensions' });
          // Error handled silently
        }
      }
    }, 'projectSelected/init chat'),
    { description: 'Initialize ChatManager on projectSelected', context: 'app' }
  );
}

function handleInitError(err) {
  const modalManager = DependencySystem.modules.get?.('modalManager');
  const shownViaModal = modalManager?.show?.('error', {
    title  : 'Application initialization failed',
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
// Boot if in browser
// ---------------------------------------------------------------------------
if (typeof window !== 'undefined') {
  // Add global error handler to catch and log any errors
  window.onerror = function(message, source, lineno, colno, error) {
    return false;
  };

  eventHandlers.trackListener(
    window,
    'unhandledrejection',
    safeHandler(function(event) {}, 'global unhandledrejection'),
    { context: 'app' }
  );

  const doc = browserAPI.getDocument();
  function forceShowLoginModal() {
    // Only show login modal if not authenticated
    const authMod = DependencySystem.modules.get?.('auth');
    if (authMod && !authMod.isAuthenticated?.()) {
      // Open the modal using modalManager if available
      const modalManager = DependencySystem.modules.get?.('modalManager');
      if (modalManager && typeof modalManager.show === 'function') {
        modalManager.show('login');
      } else {
        // Fallback: try the native dialog element directly
        const loginDlg = doc.getElementById('loginModal');
        if (loginDlg && typeof loginDlg.showModal === 'function') {
          loginDlg.showModal();
        }
      }
    }
  }

  if (doc.readyState === 'loading') {
    doc.addEventListener('DOMContentLoaded', function() {
      init().then(() => {
        // After app initializes and modals are ready, force show login
        setTimeout(forceShowLoginModal, 800);
      });
    }, { once: true });
  } else {
    setTimeout(() => {
      init().then(() => {
        setTimeout(forceShowLoginModal, 800);
      });
    }, 0);
  }
}
