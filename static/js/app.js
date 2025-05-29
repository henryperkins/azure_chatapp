import './utils/polyfillCustomEvent.js';
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

import { createBrowserService, normaliseUrl } from './utils/browserService.js';
import { setBrowserService as registerSessionBrowserService } from './utils/session.js';
import { getSessionId } from './utils/session.js';
import { createDomReadinessService } from './utils/domReadinessService.js';
import { createApiClient } from './utils/apiClient.js';
import { createHtmlTemplateLoader } from './utils/htmlTemplateLoader.js';
import { createAppInitializer } from './init/appInitializer.js';
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
registerSessionBrowserService(browserServiceInstance);
const browserAPI = browserServiceInstance;

// ---------------------------------------------------------------------------
// 2) Initialize DependencySystem (moved up, before first use)
// ---------------------------------------------------------------------------
const DependencySystem = browserAPI.getDependencySystem();
if (!DependencySystem?.modules?.get) {
  throw new Error('[App] DependencySystem not present - bootstrap aborted');
}

// ──  Bootstrap fallbacks required before eventHandlers ─────────────
if (!DependencySystem.modules.has('errorReporter')) {
  DependencySystem.register('errorReporter', { report: () => {} });
}
if (!DependencySystem.modules.has('safeHandler')) {
  const placeholderSafeHandler = (fn, lbl = 'placeholderSafeHandler') =>
        (...args) => { try { return fn?.apply?.(this, args); }
                       catch (e) { /* swallow until real SH installed */ } };
  DependencySystem.register('safeHandler', placeholderSafeHandler);
}

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
  sanitizer
});

// ---------------------------------------------------------------------------
// 6) Early app module (using factory)—no appInit yet, define it later after eventHandlers

// ---------------------------------------------------------------------------
// 7) Define app object early (CRITICAL FIX)
// ---------------------------------------------------------------------------
// ── Temporary stub logger (replaced later by the real logger) ──
const stubLogger = { debug(){}, info(){}, warn(){}, error(){}, log(){} };

const app = {}; // This will be enriched later
DependencySystem.register('app', app);

/* ──  NOW: Create eventHandlers instance via DI-compliant factory  ────────── */

const errorReporter = DependencySystem.modules.get('errorReporter');   // may be placeholder
const eventHandlers = createEventHandlers({
  DependencySystem,
  domAPI,
  browserService: browserServiceInstance,
  APP_CONFIG,
  errorReporter,
  sanitizer,
  app,
  safeHandler: DependencySystem.modules.get('safeHandler'), // fetch via DI (avoid TDZ)
  logger: stubLogger           // ← new line
  // domReadinessService to be injected after instantiation
});
DependencySystem.register('eventHandlers', eventHandlers);
// Now define appInit after eventHandlers is fully created:
/* Defer AppInitializer creation until logger & safeHandler exist */
let appInit;

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
DependencySystem.register('createApiEndpoints', createApiEndpoints);
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

/* Correct domReadinessService creation — after eventHandlers are available. */
// ---------------------------------------------------------------------------
// Create the real logger
// ---------------------------------------------------------------------------
const loggerInstance = createLogger({
  context: 'App',
  endpoint: APP_CONFIG.API_ENDPOINTS?.LOGS ?? '/api/logs',
  enableServer: false, // start disabled
  debug: APP_CONFIG.DEBUG === true,
  minLevel: APP_CONFIG.LOGGING?.MIN_LEVEL ?? 'debug',
  consoleEnabled: APP_CONFIG.LOGGING?.CONSOLE_ENABLED ?? true,
  browserService: browserServiceInstance,
  sessionIdProvider: getSessionId,
  traceIdProvider: () => DependencySystem?.modules?.get?.('traceId'),
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

// Now create domReadinessService after logger is defined
const domReadinessService = createDomReadinessService({
  DependencySystem,
  domAPI,
  browserService: browserServiceInstance,
  eventHandlers,
  APP_CONFIG,
  logger
});
DependencySystem.register('domReadinessService', domReadinessService);
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
DependencySystem.register('createApiEndpoints', createApiEndpoints);
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

/* ───────────────────────────────
   NOW create the AppInitializer
   ─────────────────────────────── */
appInit = createAppInitializer({
  /* Core infrastructure */
  DependencySystem,
  domAPI,
  browserService: browserAPI,
  eventHandlers,
  logger,
  sanitizer,
  safeHandler,
  domReadinessService,
  APP_CONFIG,
  uiUtils,
  globalUtils: DependencySystem.modules.get('globalUtils'),
  createApiEndpoints,
  getSessionId,

  /* Modal mapping constant */
  MODAL_MAPPINGS,

  /* Factories */
  createFileUploadComponent,
  createApiClient,
  createAccessibilityEnhancements,
  createNavigationService,
  createHtmlTemplateLoader,
  createUiRenderer,
  createKnowledgeBaseComponent,
  createProjectDetailsEnhancements,
  createTokenStatsManager,
  createModalManager,
  createAuthModule,
  createProjectManager,
  createModelConfig,
  createProjectDashboard,
  createProjectDetailsComponent,
  createProjectListComponent,
  createProjectModal,
  createSidebar
});

 // ---- retrofit final logger / safeHandler into the already-created eventHandlers ----
 eventHandlers.setLogger(logger);
 eventHandlers.setSafeHandler(safeHandler);
 domAPI.setLogger?.(logger);                 // ← NEW
 browserServiceInstance.setLogger?.(logger); // ← NEW

// Expose an opportunity for serviceInit to accept logger
appInit.setLogger?.(logger);

// ---- upgrade the logger with the canonical safeHandler ----
logger.setSafeHandler?.(safeHandler);          // ← NEW

// (Removed redundant serviceInit.registerBasicServices() call here)


// ----- new lazy proxy (will be overwritten by serviceInit) -----
let apiRequest = (...args) => {
  const impl = DependencySystem.modules.get('apiRequest');
  if (typeof impl !== 'function') {
    throw new Error('[app.js] apiRequest invoked before api client initialization');
  }
  // Once the real impl is available the proxy simply delegates.
  return impl(...args);
};
if (!DependencySystem.modules.has('apiRequest')) {
  DependencySystem.register('apiRequest', apiRequest);
} else {
  apiRequest = DependencySystem.modules.get('apiRequest');
}

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
app.state = appInit.state;
Object.defineProperty(app, 'isInitializing', {
  get: () => appInit.state?.initializing,
  enumerable: true,
  configurable: true
});

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------
function toggleLoadingSpinner(show) {
  const spinner = domAPI.getElementById('appLoadingSpinner');
  if (!spinner) {
    throw new Error('[toggleLoadingSpinner] Loading spinner element not found');
  }
  if (show) domAPI.removeClass(spinner, 'hidden');
  else domAPI.addClass(spinner, 'hidden');
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
    throw new Error('[fireAppReady] domReadinessService unavailable; cannot dispatch app:ready event');
  }

  /* ALSO dispatch ‘app:ready’ on window so base.html listener receives it. */
  try {
    const win = browserAPI.getWindow?.();
    if (win && typeof win.dispatchEvent === 'function') {
      const winEvt = eventHandlers.createCustomEvent('app:ready', { detail });
      /* Defer to next tick so inline script (registered after app.js)
         can attach its listener before the event is fired.            */
      browserAPI.setTimeout(() => {
        try { win.dispatchEvent(winEvt); } catch (e) { /* swallow */ }
      }, 0);
    }
  } catch (err) {
    logger.error('[fireAppReady] Failed to dispatch app:ready on window', err,
      { context: 'app:fireAppReady' });
  }

  DependencySystem.modules.get('logger')?.log('[fireAppReady] dispatched', {
    success, error, context: 'app'
  });
}

// ---------------------------------------------------------------------------
// Auth + error inits
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Core + UI inits
// ---------------------------------------------------------------------------


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

  try {
    await appInit.initializeApp();
    // Switch on server-side log shipping once the app is ready
    logger.setServerLoggingEnabled?.(true);
    exposeDebugHelpers();
    fireAppReady(true);
    return true;
  } catch (err) {
    handleInitError(err);
    throw err;
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
 * Application entrypoint and bootstrapper.
 */
/* Re-export canonical factory to eliminate duplication */
export { createAppConfig } from './appConfig.js';
