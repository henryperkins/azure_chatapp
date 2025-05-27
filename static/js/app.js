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
import { createApiEndpoints } from './utils/apiEndpoints.js';
import { createErrorReporterStub } from './utils/errorReporterStub.js';
import { createBrowserService, normaliseUrl } from './utils/browserService.js';
import { setBrowserService as registerSessionBrowserService } from './utils/session.js';
import { getSessionId } from './utils/session.js';
import { createDomReadinessService } from './utils/domReadinessService.js';
import { createApiClient } from './utils/apiClient.js';
import { createHtmlTemplateLoader } from './utils/htmlTemplateLoader.js';
import { createServiceInitializer } from './init/serviceInit.js';
import { createCoreInitializer } from './init/coreInit.js';
import { createUIInitializer } from './init/uiInit.js';
import { createAuthInitializer } from './init/authInit.js';
import { createAppStateManager } from './init/appState.js';
import { createErrorInitializer } from './init/errorInit.js';
import { safeInit } from './utils/initHelpers.js';

import {
  shouldSkipDedup,
  stableStringify,
  isAbsoluteUrl,
  isValidProjectId,
  formatBytes as globalFormatBytes,
  formatDate as globalFormatDate,
  fileIcon as globalFileIcon
} from './utils/globalUtils.js';

import { createEventHandlers } from './eventHandler.js';
import { createAuthModule } from './auth.js';
import { createChatManager } from './chat.js';
import { createProjectManager } from './projectManager.js';
import { createProjectModal, createModalManager } from './modalManager.js';
import { createModelConfig } from './modelConfig.js';
import { createProjectDashboard } from './projectDashboard.js';
import { createProjectListComponent } from './projectListComponent.js';
import { createProjectDetailsComponent } from './projectDetailsComponent.js';
import { createKnowledgeBaseComponent } from './knowledgeBaseComponent.js';
import { createAccessibilityEnhancements } from './accessibility-utils.js';
import { createNavigationService } from './navigationService.js';
import { createProjectDetailsEnhancements } from './project-details-enhancements.js';
import { createTokenStatsManager } from './tokenStatsManager.js';
import { createSidebar } from './sidebar.js';
import { createUiRenderer } from './uiRenderer.js';

import MODAL_MAPPINGS from './modalConstants.js';
import { createFileUploadComponent } from './FileUploadComponent.js';
import { createSafeHandler } from './safeHandler.js'; // Canonical SafeHandler factory

// ---------------------------------------------------------------------------
// UI helpers for KnowledgeBaseComponent
// ---------------------------------------------------------------------------
const uiUtils = {
  formatBytes: globalFormatBytes,
  formatDate: globalFormatDate,
  fileIcon: globalFileIcon
};

import { createLogger } from './logger.js';

// ---------------------------------------------------------------------------
// 1) Create base services
// ---------------------------------------------------------------------------
const browserServiceInstance = createBrowserService({
  windowObject: (typeof window !== 'undefined') ? window : undefined
});
/* ------------------------------------------------------------------ *
 * Early temporary logger – used by domAPI, eventHandlers, etc.
 * Must exist BEFORE any module that expects a logger.
 * ------------------------------------------------------------------ */
const tempLogger = {
  error: (...a) => console.error('[TempLogger]', ...a),
  warn : (...a) => console.warn ('[TempLogger]', ...a),
  info : (...a) => console.info ('[TempLogger]', ...a),
  debug: (...a) => console.debug('[TempLogger]', ...a),
  log  : (...a) => console.log  ('[TempLogger]', ...a),
};
registerSessionBrowserService(browserServiceInstance);
const browserAPI = browserServiceInstance;

// ---------------------------------------------------------------------------
// 2) Initialize DependencySystem (moved up, before first use)
// ---------------------------------------------------------------------------
const DependencySystem = browserAPI.getDependencySystem();
if (!DependencySystem?.modules?.get) {
  throw new Error('[App] DependencySystem not present - bootstrap aborted');
}

// --- EARLY SAFEHANDLER: Register dummy for boot phase to break logger/safeHandler/eventHandlers chain ---
function __dummySafeHandler(fn) {
  return typeof fn === "function" ? fn : () => { };
}
__dummySafeHandler.cleanup = function () { };
DependencySystem.register('safeHandler', __dummySafeHandler);

// Dedicated App Event Bus
const AppBus = new (browserAPI.getWindow()?.EventTarget || EventTarget)();
DependencySystem.register('AppBus', AppBus);

// ──  initialise sanitizer FIRST ──────────────────────────────────
let sanitizer = browserAPI.getWindow()?.DOMPurify;
if (!sanitizer) {
  throw new Error('[App] DOMPurify not found - aborting bootstrap for security reasons.');
}
DependencySystem.register('sanitizer', sanitizer);
DependencySystem.register('domPurify', sanitizer); // legacy alias

// ──  now it is safe to create domAPI  ────────────────────────────
const domAPI = createDomAPI({
  documentObject: browserAPI.getDocument(),
  windowObject: browserAPI.getWindow(),
  debug: APP_CONFIG.DEBUG === true,
  // logger is registered later; domAPI will pick it up via DependencySystem DI after logger is registered.
  sanitizer,
  logger         : tempLogger          // ← ADD
});

/* (deleted old domReadinessService creation; correct DI with eventHandlers after eventHandlers instantiation) */

// ---------------------------------------------------------------------------
// 6) Early app module (using factory) — NO LOGGER YET
// ---------------------------------------------------------------------------
const appModule = createAppStateManager({ DependencySystem /* logger registered later */ });
DependencySystem.register('appModule', appModule);

// ---------------------------------------------------------------------------
// 7) Define app object early (CRITICAL FIX)
// ---------------------------------------------------------------------------
const app = {}; // This will be enriched later
DependencySystem.register('app', app);

/* ──  NOW: Create eventHandlers instance via DI-compliant factory  ────────── */

const eventHandlers = createEventHandlers({
  DependencySystem,
  domAPI,
  browserService: browserServiceInstance,
  APP_CONFIG,
  errorReporter: createErrorReporterStub({ logger: tempLogger }),
  sanitizer,
  app,
  projectManager: null,
  modalManager: null,
  safeHandler: DependencySystem.modules.get('safeHandler'), // fetch via DI (avoid TDZ)
  logger        : tempLogger,   // ensure temp logger goes in
  // domReadinessService to be injected after instantiation
});
DependencySystem.register('eventHandlers', eventHandlers);

/* Correct domReadinessService creation — after eventHandlers are available. */
const domReadinessService = createDomReadinessService({
  DependencySystem,
  domAPI,
  browserService: browserServiceInstance,
  eventHandlers,
  APP_CONFIG,               // ← ADD
  logger: tempLogger        // ← ADD
});
DependencySystem.register('domReadinessService', domReadinessService);

/* Wire the circular dependency */
eventHandlers.setDomReadinessService(domReadinessService);

// ---------------------------------------------------------------------------
// 8) Register factories (no logger yet), but DO NOT createApiEndpoints here
// ---------------------------------------------------------------------------
DependencySystem.register('createModalManager', createModalManager);
DependencySystem.register('createAuthModule', createAuthModule);
DependencySystem.register('createChatManager', createChatManager);
DependencySystem.register('createProjectManager', createProjectManager);
DependencySystem.register('createModelConfig', createModelConfig);
DependencySystem.register('createProjectDashboard', createProjectDashboard);
DependencySystem.register('createProjectDetailsComponent', createProjectDetailsComponent);
DependencySystem.register('createProjectListComponent', createProjectListComponent);
DependencySystem.register('createProjectModal', createProjectModal);
DependencySystem.register('createSidebar', createSidebar);
DependencySystem.register('MODAL_MAPPINGS', MODAL_MAPPINGS);
DependencySystem.register('globalUtils', {
  shouldSkipDedup,
  stableStringify,
  normaliseUrl,
  isAbsoluteUrl,
  isValidProjectId
});

 // ---------------------------------------------------------------------------
 // 10) Create service initializer
 // ---------------------------------------------------------------------------
 const serviceInit = createServiceInitializer({
   DependencySystem,
   domAPI,
   browserServiceInstance,
   eventHandlers,
   domReadinessService,
   sanitizer,
   APP_CONFIG,
   uiUtils,
   globalUtils: {
     shouldSkipDedup,
     stableStringify,
     normaliseUrl,
     isAbsoluteUrl,
     isValidProjectId
   },
   createFileUploadComponent,
   createApiClient, // apiClient factory
   createAccessibilityEnhancements,
   createNavigationService,
   createHtmlTemplateLoader,
   createUiRenderer,
   getSessionId // logger created later
 });

// ---------------------------------------------------------------------------
// Create the real logger
// ---------------------------------------------------------------------------
const loggerInstance = createLogger({
  endpoint: APP_CONFIG.API_ENDPOINTS?.LOGS ?? '/api/logs',
  enableServer: true,
  debug: APP_CONFIG.DEBUG === true,
  minLevel: APP_CONFIG.LOGGING?.MIN_LEVEL ?? 'debug',
  consoleEnabled: APP_CONFIG.LOGGING?.CONSOLE_ENABLED ?? true,
  browserService: browserServiceInstance,
  sessionIdProvider: getSessionId,
  apiClient: DependencySystem.modules.get('apiClientObject'),
  safeHandler: DependencySystem.modules.get('safeHandler')
});
DependencySystem.register('logger', loggerInstance);
const logger = loggerInstance; // convenient local reference

// Upgrade safeHandler to use the correct logger
const safeHandlerModule = createSafeHandler({ logger, eventHandlers });
const safeHandler = safeHandlerModule.safeHandler;
if (DependencySystem.modules.has('safeHandler')) {
  DependencySystem.modules.set('safeHandler', safeHandler);
  logger.debug('[app] safeHandler upgraded to canonical', { context: 'app:safeHandler' });
} else {
  DependencySystem.register('safeHandler', safeHandler);
}

// ---- retrofit final logger / safeHandler into the already-created eventHandlers ----
// ---- retrofit final logger / safeHandler into the already-created eventHandlers ----
eventHandlers.setLogger(logger);
eventHandlers.setSafeHandler(safeHandler);
domReadinessService.setLogger(logger);   // ← NEW
domAPI.setLogger?.(logger);                 // ← NEW
browserServiceInstance.setLogger?.(logger); // ← NEW

// Expose an opportunity for serviceInit to accept logger
serviceInit.setLogger(logger);
appModule.setLogger?.(logger);            // ← NEW

// ── NOW that a real logger exists, wire the foundational services ──
serviceInit.registerBasicServices();


// Provide a lazy proxy for apiRequest until advanced services
function apiRequestProxy(...args) {
  const impl = DependencySystem.modules.get('apiRequest');
  if (typeof impl !== 'function') {
    throw new Error('[app.js] apiRequest called before being registered');
  }
  return impl(...args);
}
DependencySystem.register('apiRequest', apiRequestProxy);
const apiRequest = apiRequestProxy;

// ---------------------------------------------------------------------------
// 12) App object & top-level
// ---------------------------------------------------------------------------
let _globalInitCompleted = false;
let _globalInitInProgress = false;

Object.assign(app, {
  getProjectId: () => {
    const navigationService = DependencySystem.modules.get('navigationService');
    if (navigationService?.getUrlParams) {
      return navigationService.getUrlParams().project || null;
    }
    logger.warn('[app] getProjectId: no navigationService', { context: 'app:getProjectId' });
    return null;
  },
  getCurrentProject: () => {
    const mod = DependencySystem.modules.get('appModule');
    return mod?.getCurrentProject?.() || null;
  },
  setCurrentProject: (project) => {
    const mod = DependencySystem.modules.get('appModule');
    if (mod?.setCurrentProject) {
      mod.setCurrentProject(project);
      return project;
    }
    logger.warn('[app] setCurrentProject: appModule not found', { context: 'app:setCurrentProject' });
    return null;
  },
  navigateToConversation: async (chatId) => {
    const chatMgr = DependencySystem.modules.get('chatManager');
    if (chatMgr?.loadConversation) {
      return chatMgr.loadConversation(chatId);
    }
    return false;
  },
  validateUUID: isValidProjectId,
  setCurrentUser: (user) => {
    const mod = DependencySystem.modules.get('appModule');
    if (mod) {
      logger.info('[app] setCurrentUser -> appModule.state', {
        userId: user?.id,
        username: user?.username
      });
      mod.setAuthState({ currentUser: user });
    } else {
      logger.warn('[app] setCurrentUser: appModule not found', { context: 'app:setCurrentUser' });
    }
  }
});

app.setLifecycleState = (...args) => {
  DependencySystem.modules.get('logger')
    ?.warn?.('[app] setLifecycleState() deprecated; use setAppLifecycleState()', { context: 'app:compat' });
  DependencySystem.modules.get('appModule')?.setAppLifecycleState?.(...args);
};

app.DependencySystem = DependencySystem;
app.apiRequest = apiRequest;
app.state = appModule.state;
Object.defineProperty(app, 'isInitializing', {
  get: () => appModule.state.initializing,
  enumerable: true,
  configurable: true
});

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------
function toggleLoadingSpinner(show) {
  const spinner = domAPI.getElementById('appLoadingSpinner');
  if (spinner) {
    if (show) domAPI.removeClass(spinner, 'hidden');
    else domAPI.addClass(spinner, 'hidden');
  }
}

// ---------------------------------------------------------------------------
// Fire app:ready once
// ---------------------------------------------------------------------------
let _appReadyDispatched = false;
function fireAppReady(success = true, error = null) {
  if (_appReadyDispatched) return;
  _appReadyDispatched = true;

  app._appReadyDispatched = true;
  const detail = success
    ? { status: 200, data: { success }, message: 'ok' }
    : { status: error?.status || 500, data: error, message: error?.message || 'init-failed' };

  const drs = DependencySystem.modules.get('domReadinessService');
  if (drs?.emitReplayable) {
    drs.emitReplayable('app:ready', detail);
  } else {
    const evt = eventHandlers.createCustomEvent('app:ready', { detail });
    domAPI.dispatchEvent(domAPI.getDocument(), evt);
  }

  DependencySystem.modules.get('logger')?.log('[fireAppReady] dispatched', {
    success, error, context: 'app'
  });
}

// ---------------------------------------------------------------------------
// Auth + error inits
// ---------------------------------------------------------------------------
const authInit = createAuthInitializer({
  DependencySystem,
  domAPI,
  eventHandlers,
  logger,
  sanitizer,
  safeHandler: DependencySystem.modules.get('safeHandler'),
  domReadinessService,
  APP_CONFIG
});
DependencySystem.register('authInit', authInit);

const errorInit = createErrorInitializer({
  DependencySystem,
  browserService: browserServiceInstance,
  eventHandlers,
  logger,
  safeHandler: DependencySystem.modules.get('safeHandler')
});
DependencySystem.register('errorInit', errorInit);

// ---------------------------------------------------------------------------
// Core + UI inits
// ---------------------------------------------------------------------------
const apiClientObject = DependencySystem.modules.get('apiClientObject');
const appObj = DependencySystem.modules.get('app');
const navigationService = DependencySystem.modules.get('navigationService');
const htmlTemplateLoader = DependencySystem.modules.get('htmlTemplateLoader');
const uiRenderer = DependencySystem.modules.get('uiRenderer');
const accessibilityUtils = DependencySystem.modules.get('accessibilityUtils');

const coreInit = createCoreInitializer({
  DependencySystem,
  domAPI,
  browserService: browserServiceInstance,
  eventHandlers,
  sanitizer,
  logger,
  APP_CONFIG,
  domReadinessService,
  createKnowledgeBaseComponent,
  MODAL_MAPPINGS,
  apiRequest,
  apiClientObject,
  apiEndpoints: DependencySystem.modules.get('apiEndpoints'),   // ← ADD
  app: appObj,
  uiUtils,
  navigationService,
  globalUtils: {
    shouldSkipDedup,
    stableStringify,
    normaliseUrl,
    isAbsoluteUrl,
    isValidProjectId
  },
  FileUploadComponent: createFileUploadComponent,
  htmlTemplateLoader,
  uiRenderer,
  accessibilityUtils,
  safeHandler
});

const uiInit = createUIInitializer({
  DependencySystem,
  domAPI,
  browserService: browserServiceInstance,
  eventHandlers,
  domReadinessService,
  logger,
  APP_CONFIG,
  safeHandler: DependencySystem.modules.get('safeHandler'),
  sanitizer,
  createProjectDetailsEnhancements,
  createTokenStatsManager,
  createKnowledgeBaseComponent,
  apiRequest,
  uiUtils
});

// ---------------------------------------------------------------------------
// registerAppListeners
// ---------------------------------------------------------------------------
function registerAppListeners() {
  logger.info('[app] registerAppListeners: no op, delegated to modules', {
    context: 'app:registerAppListeners'
  });
}

// ---------------------------------------------------------------------------
// handleInitError
// ---------------------------------------------------------------------------
function handleInitError(err) {
  const modalManager = DependencySystem.modules.get('modalManager');
  const shownViaModal = modalManager?.show?.('error', {
    title: 'Application initialization failed',
    message: err?.message || 'Unknown initialization error',
    showDuringInitialization: true
  });

  domAPI.dispatchEvent(
    domAPI.getDocument(),
    eventHandlers.createCustomEvent('app:initError', { detail: { error: err } })
  );

  if (!shownViaModal) {
    try {
      const errorContainer = domAPI.getElementById('appInitError');
      if (errorContainer) {
        domAPI.setTextContent(errorContainer, `Initialization failed: ${err?.message || 'Unknown error'}`);
        domAPI.removeClass(errorContainer, 'hidden');
      }
    } catch (displayErr) {
      logger.error('[handleInitError]', displayErr, { context: 'app:handleInitError' });
    }
  }
}

/**
 * init
 * The main initialization function for the entire application lifecycle.
 */
export async function init() {
  logger.log('[App.init] Called', { context: 'app:init', ts: Date.now() });

  await domReadinessService.documentReady();

  const GLOBAL_INIT_TIMEOUT_MS = 15000;
  const PHASE_TIMEOUT = 5000;
  let globalInitTimeoutFired = false;

  const globalInitTimeoutId = browserAPI.getWindow().setTimeout(() => {
    globalInitTimeoutFired = true;
    const err = new Error(`[App.init] Global init timeout after ${GLOBAL_INIT_TIMEOUT_MS}ms.`);
    logger.error('[App.init] Emergency global timeout', err, { context: 'app:init:globalTimeout' });
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

  try {
    // Stage 1
    logger.log('[App.init] Stage 1: Global error handling', { context: 'app:init' });
    errorInit.initializeErrorHandling();
    logger.info('[App.init] Stage 1 done', { context: 'app:init' });

    // Stage 2
    logger.log('[App.init] Stage 2: advanced services registration', { context: 'app:init' });
    serviceInit.registerAdvancedServices();
    logger.info('[App.init] Stage 2 done', { context: 'app:init' });

    // Validate advanced services
    const requiredAdvancedServices = [
      'apiRequest',
      'apiClientObject',
      'navigationService',
      'htmlTemplateLoader',
      'uiRenderer',
      'accessibilityUtils'
    ];
    const missingServices = [];
    for (const sName of requiredAdvancedServices) {
      if (!DependencySystem.modules.get(sName)) {
        missingServices.push(sName);
      }
    }
    if (missingServices.length > 0) {
      const error = new Error(`Missing advanced services: ${missingServices.join(', ')}`);
      logger.error('[app.js] advanced services fail', error, { context: 'app:init', missingServices });
      throw error;
    }

    // --- Pass advanced-service instances to coreInit ------------------------
    coreInit.setAdvancedServices({
      htmlTemplateLoader: DependencySystem.modules.get('htmlTemplateLoader'),
      uiRenderer: DependencySystem.modules.get('uiRenderer'),
      accessibilityUtils: DependencySystem.modules.get('accessibilityUtils'),
      navigationService: DependencySystem.modules.get('navigationService'),
      apiClientObject: DependencySystem.modules.get('apiClientObject'),
    });
    // ------------------------------------------------------------------------

    // Stage 3
    logger.log('[App.init] Stage 3: core systems (modals, etc.)', { context: 'app:init' });
    await coreInit.initializeCoreSystems();
    logger.info('[App.init] Stage 3 done', { context: 'app:init' });

    // Stage 4
    logger.log('[App.init] Stage 4: waiting modals', { context: 'app:init' });
    await domReadinessService.waitForEvent('modalsLoaded', { timeout: 10000, context: 'app.init:modalsLoaded' });
    logger.info('[App.init] Stage 4 done', { context: 'app:init' });

    // Stage 5
    logger.log('[App.init] Stage 5: critical DI deps', { context: 'app:init' });
    await domReadinessService.dependenciesAndElements({
      deps: ['auth', 'eventHandlers', 'modalManager'],
      timeout: PHASE_TIMEOUT,
      context: 'app.init:depsReady'
    });
    logger.info('[App.init] Stage 5 done', { context: 'app:init' });

    // Stage 6 auth
    logger.log('[App.init] Stage 6: auth system', { context: 'app:init' });
    const safeAuthInit = safeHandler(() => authInit.initializeAuthSystem(), 'authInit.initializeAuthSystem');
    await safeAuthInit();
    logger.info('[App.init] Stage 6 done', { context: 'app:init' });

    // Stage 7 user
    if (appModule.state.isAuthenticated) {
      logger.log('[App.init] Stage 7: fetch current user', { context: 'app:init' });
      const authModule = DependencySystem.modules.get('auth');
      if (authModule?.fetchCurrentUser) {
        const user = await authModule.fetchCurrentUser();
        if (user) {
          app.setCurrentUser(user);
          browserAPI.setCurrentUser(user);
        }
      } else {
        logger.warn('[App.init] Stage 7: no fetchCurrentUser', { context: 'app:init' });
      }
      logger.info('[App.init] Stage 7 done', { context: 'app:init' });
    }

    // Stage 8 UI
    logger.log('[App.init] Stage 8: UI init', { context: 'app:init' });
    await uiInit.initializeUIComponents();
    logger.info('[App.init] Stage 8 done', { context: 'app:init' });

    // Stage 9
    logger.log('[App.init] Stage 9: app-level listeners', { context: 'app:init' });
    registerAppListeners();
    logger.info('[App.init] Stage 9 done', { context: 'app:init' });

    // Stage 10 nav
    logger.log('[App.init] Stage 10: navigation service', { context: 'app:init' });
    const navService = DependencySystem.modules.get('navigationService');
    if (!navService) {
      throw new Error('[App.init] no navigationService, aborting');
    }
    if (navService.init) {
      await navService.init();
    }
    logger.info('[App.init] Stage 10 done', { context: 'app:init' });

    // Stage 11 finalize
    logger.log('[App.init] Stage 11: finalize app state', { context: 'app:init' });
    appModule.setAppLifecycleState({ initialized: true });
    _globalInitCompleted = true;
    logger.info('[App.init] Stage 11 done', { context: 'app:init' });

    // Stage 12 app:ready
    if (!globalInitTimeoutFired) {
      browserAPI.getWindow().clearTimeout(globalInitTimeoutId);
      logger.log('[App.init] Stage 12: dispatching app:ready', { context: 'app:init' });
      fireAppReady(true);
    }

    // Stage 13 expose debug
    logger.log('[App.init] Stage 13: debug helpers', { context: 'app:init' });
    exposeDebugHelpers();
    logger.info('[App.init] Stage 13 done', { context: 'app:init' });

    return true;
  } catch (err) {
    logger.error('[init] failed', err, { context: 'app:init', ts: Date.now() });
    handleInitError(err);
    if (!globalInitTimeoutFired) {
      browserAPI.getWindow().clearTimeout(globalInitTimeoutId);
      fireAppReady(false, err);
    }
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
// Expose debug helpers
// ---------------------------------------------------------------------------
async function exposeDebugHelpers() {
  await domReadinessService.waitForEvent('app:ready');
  const windowObj = browserAPI.getWindow();
  if (windowObj) {
    windowObj.debugSidebarAuth = () => {
      const sb = DependencySystem.modules.get('sidebar');
      return sb?.debugAuthState
        ? sb.debugAuthState()
        : (logger.warn('[App] sidebar debug not available'), null);
    };
    windowObj.debugAppState = () => {
      const mod = DependencySystem.modules.get('appModule');
      const st = {
        appState: mod?.state,
        authInfo: {
          isAuthenticated: mod?.state?.isAuthenticated,
          currentUser: mod?.state?.currentUser
        }
      };
      logger.info('[App] Debug app state requested', st);
      return st;
    };
    logger.info('[App] debug fns: window.debugSidebarAuth(), window.debugAppState()');
  }
}

// ---------------------------------------------------------------------------
// Auto-bootstrap in browser
// ---------------------------------------------------------------------------
if (typeof window !== 'undefined') {
  (async () => {
    try {
      await init();
    } catch (err) {
      const log = DependencySystem?.modules?.get?.('logger');
      if (log?.error) {
        log.error('[app.js][bootstrap] init() failed', err, { context: 'app:bootstrap' });
      }
      try {
        fireAppReady(false, err);
      } catch (e) {
        logger.error('[app.js][bootstrap] Error in fireAppReady', e, { context: 'app:bootstrap:fireAppReady' });
      }
    }
  })();
}

/**
 * Factory required by guard-rail Rule 1
 */
export function createAppConfig({ DependencySystem } = {}) {
  if (!DependencySystem) throw new Error('[appConfig] Missing DependencySystem');
  return {
    APP_CONFIG,
    cleanup() { }
  };
}
